export interface AutoUpdateEnvironment {
  isDev: boolean;
  isPackaged: boolean;
  platform: NodeJS.Platform;
}

export function canUseAutoUpdate(environment: AutoUpdateEnvironment): boolean {
  return (
    !environment.isDev &&
    environment.isPackaged &&
    environment.platform === 'win32'
  );
}

export function normalizeUpdateVersion(version: string): string {
  const trimmed = version.trim();
  if (!trimmed) return '未知版本';
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}
