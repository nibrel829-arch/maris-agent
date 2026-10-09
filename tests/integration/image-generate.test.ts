import { afterEach, describe, expect, it } from 'vitest';
import { inspectImageBytes } from '@/server/integrations/media/image-bytes';
import { setFreeImageGeneratorForTests } from '@/server/integrations/media/free-image';
import { executeSteps } from '@/server/manager/execution-engine';
import { imageGenerateTool } from '@/server/tools/media';
import { actor, OTHER_ORG, repo, TEST_ORG } from '../helpers/context';

const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

afterEach(() => {
  setFreeImageGeneratorForTests(null);
});

describe('image.generate persistence', () => {
  it('saves verified bytes, links the task, and hides the file from another organization', async () => {
    setFreeImageGeneratorForTests(async () => {
      const inspected = inspectImageBytes(PNG);
      if (!inspected.ok) throw new Error(inspected.message);
      return {
        status: 'generated',
        bytes: PNG,
        mimeType: inspected.mimeType,
        provider: 'nibrexo',
        model: 'test-fixture-not-a-live-model',
        width: 1,
        height: 1,
        applied: { negativePrompt: false, dimensions: true, steps: 1 },
        ignored: [],
        sha256: 'fixture',
      };
    });
    const store = repo();
    const owner = actor();
    const output = await imageGenerateTool.execute(
      { title: 'Clinic reception', prompt: 'A calm reception desk' },
      {
        actor: owner,
        taskId: '00000000-0000-0000-0000-0000000000aa',
        organizationId: TEST_ORG,
        repo: store,
        runId: 'run',
        idempotencyKey: 'idem_image_1',
        stepId: 'step-1',
      },
    );
    const saved = output as {
      executed: boolean;
      imageAsset: { mediaId: string; bytes: number };
      contentItem: { id: string; media_url: string | null };
      media: { id: string; task_id?: string; sha256?: string };
    };
    expect(saved.executed).toBe(true);
    expect(saved.imageAsset.bytes).toBe(PNG.byteLength);
    expect(saved.media.task_id).toBe('00000000-0000-0000-0000-0000000000aa');
    expect(saved.contentItem.media_url).toBe(`/api/workspace/content/media/${saved.media.id}/file`);
    expect(await store.mediaFiles.get(saved.media.id, OTHER_ORG)).toBeNull();
    expect(await store.contentItems.get(saved.contentItem.id, OTHER_ORG)).toBeNull();
    const own = await store.mediaFiles.get(saved.media.id, TEST_ORG);
    expect(own?.step_id).toBe('step-1');
    expect(own?.provider).toBe('nibrexo');
  });

  it('does not save a file when the provider returns text instead of image bytes', async () => {
    setFreeImageGeneratorForTests(async () => ({
      status: 'generated',
      bytes: new TextEncoder().encode('this is only a prompt'),
      mimeType: 'image/png',
      provider: 'nibrexo',
      model: 'bad-fixture',
      width: null,
      height: null,
      applied: { negativePrompt: false, dimensions: false, steps: 1 },
      ignored: [],
      sha256: 'nope',
    }));
    const store = repo();
    await expect(
      imageGenerateTool.execute(
        { title: 'Not an image', prompt: 'prompt only' },
        {
          actor: actor(),
          taskId: '00000000-0000-0000-0000-0000000000ab',
          organizationId: TEST_ORG,
          repo: store,
          runId: 'run',
          idempotencyKey: 'idem_image_bad',
          stepId: 'step-1',
        },
      ),
    ).rejects.toThrow(/not a PNG|empty or truncated|placeholder/i);
    expect(await store.mediaFiles.list(TEST_ORG, { limit: 10 })).toEqual([]);
    expect(await store.contentItems.list(TEST_ORG, { limit: 10 })).toEqual([]);
  });

  it('denies a role that cannot create content and stores nothing', async () => {
    setFreeImageGeneratorForTests(async () => {
      throw new Error('provider should not be called');
    });
    const store = repo();
    const outcome = await executeSteps(
      [
        {
          id: 'step-1',
          title: 'Generate',
          rationale: 'test',
          skillId: 'visual-content',
          toolName: 'image.generate',
          input: { title: 'Hidden', prompt: 'Should not run' },
          requiresApproval: false,
          risk: 'low',
          stage: 'execute',
          dependsOn: [],
          clarification: null,
        },
      ],
      {
        actor: actor({ role: 'client' }),
        repo: store,
        taskId: '00000000-0000-0000-0000-0000000000ac',
        runId: 'run',
        organizationId: TEST_ORG,
      },
    );
    expect(outcome.stepResults[0]?.status).toBe('denied');
    expect(await store.mediaFiles.list(TEST_ORG, { limit: 10 })).toEqual([]);
  });

  it('stops after the hourly limit without another provider call', async () => {
    let calls = 0;
    setFreeImageGeneratorForTests(async () => {
      calls += 1;
      const inspected = inspectImageBytes(PNG);
      if (!inspected.ok) throw new Error(inspected.message);
      return {
        status: 'generated',
        bytes: PNG,
        mimeType: inspected.mimeType,
        provider: 'nibrexo',
        model: 'test-fixture-not-a-live-model',
        width: 1,
        height: 1,
        applied: { negativePrompt: false, dimensions: true, steps: 1 },
        ignored: [],
        sha256: 'fixture',
      };
    });
    const store = repo();
    const owner = actor();
    for (let index = 0; index < 4; index += 1) {
      const output = await imageGenerateTool.execute(
        { title: `Image ${index}`, prompt: 'A square' },
        {
          actor: owner,
          taskId: '00000000-0000-0000-0000-0000000000ad',
          organizationId: TEST_ORG,
          repo: store,
          runId: 'run',
          idempotencyKey: `idem_quota_${index}`,
          stepId: `step-${index}`,
        },
      );
      expect((output as { executed: boolean }).executed).toBe(true);
    }
    const blocked = await imageGenerateTool.execute(
      { title: 'Image 5', prompt: 'A square' },
      {
        actor: owner,
        taskId: '00000000-0000-0000-0000-0000000000ad',
        organizationId: TEST_ORG,
        repo: store,
        runId: 'run',
        idempotencyKey: 'idem_quota_5',
        stepId: 'step-5',
      },
    );
    expect((blocked as { capabilityStatus: string }).capabilityStatus).toBe('quota_exhausted');
    expect(calls).toBe(4);
    expect(await store.mediaFiles.list(TEST_ORG, { limit: 10 })).toHaveLength(4);
  });

  it('retries a failed generation without duplicating a completed file', async () => {
    let calls = 0;
    setFreeImageGeneratorForTests(async () => {
      calls += 1;
      if (calls === 1) return { status: 'error', message: 'weights were not loaded', retryable: true };
      const inspected = inspectImageBytes(PNG);
      if (!inspected.ok) throw new Error(inspected.message);
      return {
        status: 'generated',
        bytes: PNG,
        mimeType: inspected.mimeType,
        provider: 'nibrexo',
        model: 'test-fixture-not-a-live-model',
        width: 1,
        height: 1,
        applied: { negativePrompt: false, dimensions: true, steps: 1 },
        ignored: [],
        sha256: 'fixture',
      };
    });
    const store = repo();
    const owner = actor();
    const context = {
      actor: owner,
      taskId: '00000000-0000-0000-0000-0000000000ae',
      organizationId: TEST_ORG,
      repo: store,
      runId: 'run',
      idempotencyKey: 'idem_retry_image',
      stepId: 'step-retry',
    };
    await expect(imageGenerateTool.execute({ title: 'Lamp', prompt: 'A desk lamp' }, context)).rejects.toThrow(/weights/);
    expect(await store.mediaFiles.list(TEST_ORG, { limit: 10 })).toEqual([]);
    const saved = await imageGenerateTool.execute({ title: 'Lamp', prompt: 'A desk lamp' }, context);
    expect((saved as { executed: boolean }).executed).toBe(true);
    const again = await imageGenerateTool.execute({ title: 'Lamp', prompt: 'A desk lamp' }, context);
    expect((again as { media: { id: string } }).media.id).toBe((saved as { media: { id: string } }).media.id);
    expect(calls).toBe(2);
    expect(await store.mediaFiles.list(TEST_ORG, { limit: 10 })).toHaveLength(1);
  });
});
