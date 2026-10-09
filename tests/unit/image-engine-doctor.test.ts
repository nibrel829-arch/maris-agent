import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('nibrexo image engine doctor', () => {
  it('does not claim it can generate when weights or hardware are missing', () => {
    const result = spawnSync('python3', ['scripts/nibrexo-image-engine.py', 'doctor'], {
      encoding: 'utf8',
      env: { ...process.env, NIBREXO_IMAGE_WEIGHTS_DIR: '' },
    });
    expect(result.status).toBe(2);
    const report = JSON.parse(result.stdout) as {
      canGenerate: boolean;
      engine: string;
      missing: string[];
      message: string;
      inferenceTested: boolean;
      practicalOption: { thisMachineCanRun: boolean; license: string };
    };
    expect(report.engine).toBe('nibrexo-image-engine');
    expect(report.canGenerate).toBe(false);
    expect(report.missing).toContain('NIBREXO_IMAGE_WEIGHTS_DIR');
    expect(report.message).toMatch(/NIBREXO_IMAGE_WEIGHTS_DIR/);
    expect(report.message.toLowerCase()).not.toContain('api.openai.com');
    expect(report.inferenceTested).toBe(false);
    expect(report.practicalOption.thisMachineCanRun).toBe(false);
    expect(report.practicalOption.license).toBe('CreativeML Open RAIL-M');
  });

  it('does not write an image file when generation is impossible', () => {
    const out = 'tmp-nibrexo-image-should-not-exist.png';
    const result = spawnSync(
      'python3',
      ['scripts/nibrexo-image-engine.py', 'generate', '--prompt', 'a red square', '--out', out],
      { encoding: 'utf8', env: { ...process.env, NIBREXO_IMAGE_WEIGHTS_DIR: '' } },
    );
    expect(result.status).not.toBe(0);
    expect(existsSync(out)).toBe(false);
    const report = JSON.parse(result.stdout) as { wroteFile: boolean; canGenerate: boolean };
    expect(report.canGenerate).toBe(false);
    expect(report.wroteFile).toBe(false);
  });
});
