export type MatrixKey = string;
export type MatrixGrid = Record<string, Record<string, number | null>>;

export type MatricesResponse = {
  ts: number;
  coins?: string[];
  matrices: Record<MatrixKey, MatrixGrid>;
};
