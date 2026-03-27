export async function compressImage(file: File) {
  if (!file.type.startsWith('image/')) {
    return file
  }

  const dataUrl = await readAsDataUrl(file)
  const image = await loadImage(dataUrl)
  const maxDimension = 1600
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')

  if (!context) {
    return file
  }

  context.drawImage(image, 0, 0, width, height)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.82)
  })

  if (!blob) {
    return file
  }

  return new File([blob], renameAsJpeg(file.name), {
    type: 'image/jpeg',
    lastModified: Date.now(),
  })
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Unable to read the selected image.'))
    reader.readAsDataURL(file)
  })
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to process the selected image.'))
    image.src = source
  })
}

function renameAsJpeg(filename: string) {
  const base = filename.replace(/\.[^.]+$/, '')
  return `${base}.jpg`
}
