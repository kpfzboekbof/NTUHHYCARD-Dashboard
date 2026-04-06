/** Display names for hospital codes */
export const HOSPITALS: Record<number, string> = {
  0: '總院',
  1: '新竹',
  2: '雲林',
  3: '新竹', // 生醫 → 新竹
  4: '新竹', // 竹東 → 新竹
  5: '雲林', // 斗六 → 雲林
};

export const HOSPITAL_OPTIONS = [
  { value: '全部', label: '全部' },
  { value: '總院', label: '總院' },
  { value: '新竹', label: '新竹' },
  { value: '雲林', label: '雲林' },
];
