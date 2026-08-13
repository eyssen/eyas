import { useRef, useState, useCallback } from 'react'
import { UploadCloud, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDocumentsStore } from '@/stores/documents-store'
import { t } from './i18n'

interface UploadZoneProps {
  ownerModule: string
  ownerId: string
  compact?: boolean
  className?: string
}

export function UploadZone({ ownerModule, ownerId, compact = false, className }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { uploadFile } = useDocumentsStore()

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files)
      for (const file of arr) {
        uploadFile(file, ownerModule, ownerId)
      }
    },
    [uploadFile, ownerModule, ownerId]
  )

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files)
      // Reset so the same file can be uploaded again
      e.target.value = ''
    }
  }

  if (compact) {
    return (
      <div className={className}>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={onInputChange}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
        >
          <Paperclip className="h-3.5 w-3.5" />
          {t('documents.upload.attach')}
        </button>
      </div>
    )
  }

  return (
    <div className={cn('w-full', className)}>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onInputChange}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          'w-full flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-16 transition-colors text-center',
          isDragging
            ? 'border-[var(--vibrancy-border)] bg-accent/50 text-foreground'
            : 'border-[var(--vibrancy-border)] text-muted-foreground hover:text-foreground hover:bg-accent/50'
        )}
      >
        <UploadCloud className="h-10 w-10 opacity-40" />
        <div className="flex flex-col gap-1">
          <span className="text-[14px] font-medium">{t('documents.upload.drop')}</span>
          <span className="text-[12px] opacity-60">{t('documents.upload.browse')}</span>
        </div>
      </button>
    </div>
  )
}
