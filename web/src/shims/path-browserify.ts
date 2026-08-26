const normalize = (value: string): string => {
  const parts = value.replace(/\\/g, '/').split('/');
  const output: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (output.length && output[output.length - 1] !== '..') output.pop();
      else output.push(part);
    } else {
      output.push(part);
    }
  }

  return `${value.startsWith('/') ? '/' : ''}${output.join('/')}` || '.';
};

export const join = (...segments: string[]): string => normalize(segments.join('/'));

export default { join };
