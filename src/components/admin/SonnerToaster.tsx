import { Toaster } from "sonner"

// Sonner (Emil Kowalski's toast lib) themed to the admin surface. Mounted once in
// AdminLayout; toasts are fired from islands/pages via `import { toast } from "sonner"`.
export function SonnerToaster() {
  return (
    <Toaster
      position="top-center"
      richColors
      closeButton
      toastOptions={{
        style: {
          fontFamily: "var(--font-sans)",
          borderRadius: "var(--radius-lg)",
        },
      }}
    />
  )
}
