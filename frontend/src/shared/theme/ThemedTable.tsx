import { Table as AntTable, type TableProps } from 'antd';

/** 原型 .aw-table：表头与单元格默认左对齐；需要居中的列由页面显式声明 align。 */
export function Table<T extends object>(props: TableProps<T>) {
  return <AntTable<T> {...props} />;
}
