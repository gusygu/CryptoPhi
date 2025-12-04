declare module "gray-matter" {
  interface GrayMatterFile<T = any> {
    data: T;
    content: string;
    excerpt?: string;
  }

  type MatterOptions = Record<string, unknown>;

  function matter<T = any>(input: string, options?: MatterOptions): GrayMatterFile<T>;
  export = matter;
}

declare module "remark" {
  const remark: any;
  export default remark;
}

declare module "remark-html" {
  const html: any;
  export default html;
}
