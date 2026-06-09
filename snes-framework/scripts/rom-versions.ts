// ROM version metadata shared by build and extract scripts.

import type { RomVersion } from './types.ts';
export type { RomVersion } from './types.ts';

export interface RomInfo {
  /** Bit flag used by the framework's ROMVer define (matches AssetPointersAndFiles.asm). */
  bit: number;
  /** Human-readable suffix used in the assembled SFC filename. */
  label: string;
  /** Base ROM name used in the assembled SFC filename. */
  baseName: string;
  /** Filename expected in reference/ for asset extraction. */
  cartFilename: string;
  /** MD5 of the canonical headerless cart dump. Empty for unsupported versions. */
  md5: string;
  /** True if the upstream YI disassembly supports building this version. */
  supported: boolean;
}

export const ROM_VERSIONS: Record<RomVersion, RomInfo> = {
  YI_U1: { bit: 0x0001, label: 'USA V1.0',     baseName: "Super Mario World 2 - Yoshi's Island", cartFilename: 'YI_USA1.sfc', md5: 'cb472164c5a71ccd3739963390ec6a50', supported: true  },
  YI_U2: { bit: 0x0002, label: 'USA V1.1',     baseName: "Super Mario World 2 - Yoshi's Island", cartFilename: 'YI_USA2.sfc', md5: 'ce1e3e33b6e39d37b43d7de599f9e785', supported: true  },
  YI_E1: { bit: 0x0004, label: 'Europe V1.0',  baseName: "Super Mario World 2 - Yoshi's Island", cartFilename: 'YI_PAL1.sfc', md5: '', supported: false },
  YI_E2: { bit: 0x0008, label: 'Europe V1.1',  baseName: "Super Mario World 2 - Yoshi's Island", cartFilename: 'YI_PAL2.sfc', md5: '', supported: false },
  YI_J1: { bit: 0x0010, label: 'Japan V1.0',   baseName: 'Super Mario - Yoshi Island',           cartFilename: 'YI_JP1.sfc',  md5: '', supported: false },
  YI_J2: { bit: 0x0020, label: 'Japan V1.1',   baseName: 'Super Mario - Yoshi Island',           cartFilename: 'YI_JP2.sfc',  md5: '', supported: false },
  YI_J3: { bit: 0x0040, label: 'Japan V1.2',   baseName: 'Super Mario - Yoshi Island',           cartFilename: 'YI_JP3.sfc',  md5: '', supported: false },
};

/** Look up a ROM version by its canonical cart MD5. Returns null if unknown. */
export function identifyByMd5(md5: string): RomVersion | null {
  for (const v of Object.keys(ROM_VERSIONS) as RomVersion[]) {
    const info = ROM_VERSIONS[v];
    if (info.md5 && info.md5 === md5) return v;
  }
  return null;
}

export function parseRomVersion(arg: string | undefined, fallback: RomVersion = 'YI_U2'): RomVersion {
  const v = (arg ?? fallback) as RomVersion;
  if (!(v in ROM_VERSIONS)) {
    const valid = Object.keys(ROM_VERSIONS).join(', ');
    throw new Error(`Unknown ROM version "${arg}". Valid: ${valid}`);
  }
  if (!ROM_VERSIONS[v].supported) {
    throw new Error(`ROM version "${v}" is recognized but not supported by the upstream YI disassembly.`);
  }
  return v;
}

export function outputSfcName(v: RomVersion): string {
  const info = ROM_VERSIONS[v];
  return `${info.baseName} (${info.label}).sfc`;
}
