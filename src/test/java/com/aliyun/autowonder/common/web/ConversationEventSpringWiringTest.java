package com.aliyun.autowonder.common.web;

import com.aliyun.autowonder.configuration.ConversationEventReadConfiguration;
import com.aliyun.autowonder.conversation.ConversationEventDisplayPreparationService;
import com.aliyun.autowonder.conversation.ConversationEventDisplayReadService;
import com.aliyun.autowonder.conversation.ConversationEventDisplayWorker;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.lang.reflect.Constructor;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Guards the class of defect that blocked the E2E application start: a component with more than
 * one unannotated constructor makes Spring 2.7 fail the context refresh. Unit tests that call
 * {@code new} directly cannot see it, so this test boots a real Spring context for the bean.
 */
class ConversationEventSpringWiringTest {

    @Test
    void boundedResponseBeanStartsInARealSpringContext() {
        new ApplicationContextRunner()
                .withBean(ObjectMapper.class, ObjectMapper::new)
                .withBean(ConversationEventReadConfiguration.class,
                        () -> new ConversationEventReadConfiguration(8, true, 20_000, 5_000))
                .withBean(ConversationEventBoundedResponse.class)
                .run(context -> {
                    assertNull(context.getStartupFailure(),
                            () -> "context failed to start: " + context.getStartupFailure());
                    assertNotNull(context.getBean(ConversationEventBoundedResponse.class));
                });
    }

    @Test
    void conversationDisplayComponentsExposeExactlyOneConstructor() {
        for (Class<?> type : List.of(
                ConversationEventBoundedResponse.class,
                ConversationEventReadConfiguration.class,
                ConversationEventDisplayReadService.class,
                ConversationEventDisplayPreparationService.class,
                ConversationEventDisplayWorker.class)) {
            long count = Arrays.stream(type.getDeclaredConstructors())
                    .filter(constructor -> !constructor.isSynthetic())
                    .count();
            assertEquals(1, count, type.getSimpleName()
                    + " must expose exactly one constructor for Spring autowiring");
        }
    }
}
