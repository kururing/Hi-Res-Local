function specPath(file: unknown): string {
  if (typeof file === 'string') return file;
  if (file && typeof file === 'object') {
    const rec = file as { moduleId?: string; filepath?: string };
    return rec.moduleId ?? rec.filepath ?? '';
  }
  return '';
}

function isCoverageFile(file: unknown): boolean {
  return specPath(file).replaceAll('\\', '/').includes('zzz-coverage');
}

export default class CoverageLastSequencer {
  async shard(files: unknown[]): Promise<unknown[]> {
    return files;
  }

  async sort(files: unknown[]): Promise<unknown[]> {
    return [...files].sort((left, right) => {
      const aLast = isCoverageFile(left);
      const bLast = isCoverageFile(right);
      if (aLast === bLast) return 0;
      return aLast ? 1 : -1;
    });
  }
}
