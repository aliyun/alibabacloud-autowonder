import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkitemCreateAttachments, appendCreateAttachments } from './WorkitemCreateAttachments';

function file(name: string, size = 4): File {
  return new File([new Uint8Array(size)], name, { type: 'text/plain' });
}

describe('appendCreateAttachments', () => {
  it('appends new files without mutating the current selection', () => {
    const current = [file('a.txt')];
    const result = appendCreateAttachments(current, [file('b.txt')]);

    expect(result.error).toBeUndefined();
    expect(result.files.map((item) => item.name)).toEqual(['a.txt', 'b.txt']);
    expect(current.map((item) => item.name)).toEqual(['a.txt']);
  });

  it('ignores an empty selection', () => {
    const current = [file('a.txt')];
    expect(appendCreateAttachments(current, [])).toEqual({ files: current });
  });

  it('rejects a duplicate file name and keeps the selection unchanged', () => {
    const current = [file('a.txt')];
    const result = appendCreateAttachments(current, [file('A.TXT')]);

    expect(result.error).toBe('附件已存在：A.TXT');
    expect(result.files).toBe(current);
  });

  it('rejects a selection that would exceed the attachment count limit', () => {
    const current = Array.from({ length: 10 }, (_, index) => file(`file-${index}.txt`));
    const result = appendCreateAttachments(current, [file('extra.txt')]);

    expect(result.error).toBe('最多上传 10 个需求/设计上下文附件');
    expect(result.files).toBe(current);
  });
});

describe('WorkitemCreateAttachments', () => {
  it('renders the picker hint and forwards the picked files', () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(<WorkitemCreateAttachments files={[]} onAdd={onAdd} onRemove={onRemove} />);

    expect(screen.getByText('支持粘贴截图或选择文件；单个最大 5 MB，最多 10 个、总计 20 MB。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '移除附件 note.txt' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('workitem-create-file-input'), {
      target: { files: [file('note.txt')] },
    });

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect((onAdd.mock.calls[0][0] as File[]).map((item) => item.name)).toEqual(['note.txt']);
  });

  it('keeps the native file input hidden so the button is the only attach control', () => {
    render(<WorkitemCreateAttachments files={[]} onAdd={vi.fn()} onRemove={vi.fn()} />);

    // antd Form 的 `.ant-form input[type="file"] { display: block }` 会覆盖 hidden，必须用内联样式兜底。
    expect(screen.getByTestId('workitem-create-file-input')).toHaveStyle({ display: 'none' });
    // 按钮可访问名含图标（paper-clip 添加文件或图片），按文本片段匹配。
    expect(screen.getAllByRole('button', { name: /添加文件或图片/ })).toHaveLength(1);
  });

  it('does not report an empty file selection', () => {
    const onAdd = vi.fn();
    render(<WorkitemCreateAttachments files={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    fireEvent.change(screen.getByTestId('workitem-create-file-input'), { target: { files: [] } });

    expect(onAdd).not.toHaveBeenCalled();
  });

  it('opens the file picker from the button and removes a selected file', async () => {
    const onRemove = vi.fn();
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    render(<WorkitemCreateAttachments files={[file('note.txt')]} onAdd={vi.fn()} onRemove={onRemove} />);

    expect(screen.getByText('note.txt')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /添加文件或图片/ }));
    expect(clickSpy).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '移除附件 note.txt' }));
    expect(onRemove).toHaveBeenCalledWith(0);

    clickSpy.mockRestore();
  });
});
