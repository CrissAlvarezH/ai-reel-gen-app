// localStorage that never throws (private mode, blocked storage): preferences are a convenience.
export const read = (k: string, fallback: string) => {
  try {
    return localStorage.getItem(k) ?? fallback;
  } catch {
    return fallback;
  }
};

export const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};
