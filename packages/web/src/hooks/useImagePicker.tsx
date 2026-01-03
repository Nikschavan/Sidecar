import { useState, useCallback, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { ImageBlock } from '@sidecar/shared'

export interface AttachedImage {
  id: string
  file: File
  preview: string
  block: ImageBlock
}

// Convert file to ImageBlock
async function fileToImageBlock(file: File): Promise<ImageBlock> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64Data = dataUrl.split(',')[1]
      // Default to jpeg if type is empty (iOS sometimes does this)
      let mediaType = file.type || 'image/jpeg'
      // Map HEIC/HEIF to jpeg since they get converted
      if (mediaType === 'image/heic' || mediaType === 'image/heif') {
        mediaType = 'image/jpeg'
      }

      resolve({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType as ImageBlock['source']['media_type'],
          data: base64Data
        }
      })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Check if file is an image
function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  // Check extension as fallback (iOS sometimes has empty type)
  return /\.(jpg|jpeg|png|gif|webp|heic|heif|bmp)$/i.test(file.name)
}

export function useImagePicker() {
  const [images, setImages] = useState<AttachedImage[]>([])

  // Process files and add to images
  const processFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    console.log('[useImagePicker] Processing', fileArray.length, 'files')

    for (const file of fileArray) {
      console.log('[useImagePicker] File:', file.name, 'type:', file.type, 'size:', file.size)

      if (!isImageFile(file)) {
        console.log('[useImagePicker] Skipping non-image file')
        continue
      }

      try {
        const block = await fileToImageBlock(file)
        const preview = URL.createObjectURL(file)
        const attached: AttachedImage = {
          id: uuidv4(),
          file,
          preview,
          block
        }
        console.log('[useImagePicker] Adding image')
        setImages(prev => [...prev, attached])
      } catch (err) {
        console.error('[useImagePicker] Failed to process image:', err)
      }
    }
  }, [])

  // Handle paste events (for clipboard images)
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      const imageFiles: File[] = []
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            imageFiles.push(file)
          }
        }
      }

      if (imageFiles.length > 0) {
        console.log('[useImagePicker] Pasted', imageFiles.length, 'images')
        await processFiles(imageFiles)
      }
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [processFiles])

  // Remove an image
  const removeImage = useCallback((id: string) => {
    setImages(prev => {
      const img = prev.find(i => i.id === id)
      if (img) {
        URL.revokeObjectURL(img.preview)
      }
      return prev.filter(i => i.id !== id)
    })
  }, [])

  // Clear all images
  const clearImages = useCallback(() => {
    images.forEach(img => URL.revokeObjectURL(img.preview))
    setImages([])
  }, [images])

  // Get ImageBlocks for sending
  const getImageBlocks = useCallback((): ImageBlock[] => {
    return images.map(img => img.block)
  }, [images])

  return {
    images,
    processFiles,
    removeImage,
    clearImages,
    getImageBlocks,
    hasImages: images.length > 0
  }
}
