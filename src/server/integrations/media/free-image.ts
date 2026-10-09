/**
 * Compatibility wrapper. Image generation goes through the Nibrexo engine.
 * OpenAI, Cloudflare, Pollinations and Arena are not called from here.
 */

export {
  generateNativeImage as generateFreeImage,
  isExternalImageHost as isPaidImageHost,
  nativeImageRuntimeConfigured as freeImageRuntimeConfigured,
  nativeImageSetupMessage as freeImageSetupMessage,
  setNativeImageGeneratorForTests as setFreeImageGeneratorForTests,
  sha256Bytes,
  type NativeImageRequest as FreeImageRequest,
  type NativeImageResult as FreeImageResult,
  type AppliedImageOptions,
} from '@/server/media/engine/native-engine';
