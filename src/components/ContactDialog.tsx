import * as React from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";

interface Props {
  whatsappUrl: string;
  phone?: string;
  email?: string;
}

const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413" />
  </svg>
);

export function ContactDialog({ whatsappUrl, phone, email }: Props) {
  return (
    <Dialog>
      <DialogTrigger className="contact-dialog-trigger">
        Contact us
      </DialogTrigger>

      <DialogContent>
        <DialogTitle>Talk to Rentoo</DialogTitle>
        <DialogDescription>
          WhatsApp is the fastest way to reach us. We reply in under 30 minutes during business hours.
        </DialogDescription>

        <div className="contact-dialog-actions">
          <a href={whatsappUrl} className="contact-dialog-btn contact-dialog-btn--wa">
            <WhatsAppIcon />
            <span>Chat on WhatsApp</span>
          </a>

          {phone && (
            <a href={`tel:${phone}`} className="contact-dialog-btn contact-dialog-btn--secondary">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.63 19.79 19.79 0 01.5 1.18 2 2 0 012.49.5h3a2 2 0 012 1.72c.13.96.36 1.9.69 2.81a2 2 0 01-.45 2.11L6.91 8.46a16 16 0 006.63 6.63l1.27-1.27a2 2 0 012.11-.45c.91.33 1.85.56 2.81.69A2 2 0 0122 16.92z"/>
              </svg>
              <span>Call {phone}</span>
            </a>
          )}

          {email && (
            <a href={`mailto:${email}`} className="contact-dialog-btn contact-dialog-btn--secondary">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="m22 7-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7"/>
              </svg>
              <span>Email {email}</span>
            </a>
          )}
        </div>

        <p className="contact-dialog-meta">Open all week · 10:00–20:00 IST</p>

        <DialogClose className="contact-dialog-dismiss">Dismiss</DialogClose>
      </DialogContent>
    </Dialog>
  );
}
