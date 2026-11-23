package com.aliyun.autowonder.workitem;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.MappingIterator;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.AbstractList;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/** Replayable, request-owned storage for progress details whose contract requires every row. */
public final class DeliveryProgressSpill implements AutoCloseable {
    private static final String ATTRIBUTE = DeliveryProgressSpill.class.getName();
    private static final int BATCH_SIZE = 1024;
    private static final int MAX_PENDING_ROWS = 8192;
    private static final Logger LOG = LoggerFactory.getLogger(DeliveryProgressSpill.class);
    private static final ObjectMapper CODEC = new ObjectMapper().setSerializationInclusion(JsonInclude.Include.NON_NULL);
    private final Set<ReplayList<?>> buffered = java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<>());
    private int pendingRows;
    private final List<Path> files = new ArrayList<>();
    private final Set<MappingIterator<?>> readers = new HashSet<>();

    static DeliveryProgressSpill forRequest() {
        RequestAttributes request = RequestContextHolder.getRequestAttributes();
        if (request == null) return null;
        DeliveryProgressSpill spill = existing();
        if (spill == null) {
            spill = new DeliveryProgressSpill();
            request.setAttribute(ATTRIBUTE, spill, RequestAttributes.SCOPE_REQUEST);
            request.registerDestructionCallback(ATTRIBUTE, spill::close, RequestAttributes.SCOPE_REQUEST);
        }
        return spill;
    }

    public static DeliveryProgressSpill usedByRequest() {
        DeliveryProgressSpill spill = existing();
        return spill != null && !spill.files.isEmpty() ? spill : null;
    }

    private static DeliveryProgressSpill existing() {
        RequestAttributes request = RequestContextHolder.getRequestAttributes();
        return request == null ? null
                : (DeliveryProgressSpill) request.getAttribute(ATTRIBUTE, RequestAttributes.SCOPE_REQUEST);
    }

    public Path newFile() throws IOException {
        Path file = Files.createTempFile("aw-delivery-progress-", ".tmp");
        files.add(file);
        return file;
    }

    @Override
    public void close() {
        for (var reader : readers) {
            try {
                reader.close();
            } catch (IOException exception) {
                LOG.warn("Could not close progress reader", exception);
            }
        }
        readers.clear();
        for (Path file : files) {
            try {
                Files.deleteIfExists(file);
            } catch (IOException exception) {
                LOG.warn("Could not remove progress temporary file", exception);
            }
        }
        files.clear();
        buffered.clear();
    }

    void discard(List<?> rows) {
        if (rows instanceof DeliveryProgressSpill.ReplayList<?> replay) {
            replay.clearPending();
            if (replay.file != null) {
                try {
                    Files.deleteIfExists(replay.file);
                    files.remove(replay.file);
                } catch (IOException exception) {
                    throw new UncheckedIOException(exception);
                }
            }
        }
    }

    <T> List<T> list(Class<T> type) {
        return new ReplayList<>(type);
    }

    private final class ReplayList<T> extends AbstractList<T> {
        private final Class<T> type;
        private final List<T> pending = new ArrayList<>();
        private Path file;
        private int size;

        private ReplayList(Class<T> type) {
            this.type = type;
        }

        @Override
        public boolean add(T item) {
            modCount++;
            if (pending.isEmpty()) buffered.add(this);
            pending.add(item);
            pendingRows++;
            size++;
            if (pending.size() >= BATCH_SIZE) {
                flush();
            } else if (pendingRows >= MAX_PENDING_ROWS) {
                buffered.stream().max(java.util.Comparator.comparingInt(rows -> rows.pending.size()))
                        .orElseThrow().flush();
            }
            return true;
        }

        private void flush() {
            if (pending.isEmpty()) return;
            try {
                if (file == null) file = newFile();
                try (var out = new BufferedOutputStream(Files.newOutputStream(file, StandardOpenOption.APPEND));
                     var writer = CODEC.writerFor(type).writeValues(out)) {
                    writer.writeAll(pending);
                    writer.flush();
                    out.write('\n');
                }
                clearPending();
            } catch (IOException exception) {
                throw new UncheckedIOException(exception);
            }
        }

        private void clearPending() {
            pendingRows -= pending.size();
            pending.clear();
            buffered.remove(this);
        }

        @Override
        public int size() {
            return size;
        }

        @Override
        public T get(int index) {
            Objects.checkIndex(index, size);
            if (file == null) return pending.get(index);
            try (var reader = open()) {
                for (int i = 0; i < index; i++) reader.nextValue();
                return reader.nextValue();
            } catch (IOException exception) {
                throw new UncheckedIOException(exception);
            }
        }

        private MappingIterator<T> open() throws IOException {
            flush();
            var stream = new BufferedInputStream(Files.newInputStream(file));
            try {
                return CODEC.readerFor(type).readValues(stream);
            } catch (IOException | RuntimeException exception) {
                stream.close();
                throw exception;
            }
        }

        @Override
        public Iterator<T> iterator() {
            if (file == null) return pending.iterator();
            try {
                var reader = open();
                readers.add(reader);
                return new Iterator<>() {
                    @Override
                    public boolean hasNext() {
                        boolean next = reader.hasNext();
                        if (!next) readers.remove(reader);
                        return next;
                    }

                    @Override
                    public T next() {
                        return reader.next();
                    }
                };
            } catch (IOException exception) {
                throw new UncheckedIOException(exception);
            }
        }
    }
}
