import Image from "next/image";

// Avatar (Story 3.10, AC-1/AC-5, D-4): provider photo when one exists,
// monogram fallback otherwise — circular (`--radius-full`), 1px
// `outline-variant` border, image only, no interaction of its own. Shared by
// the floating nav (~20px) and the Settings profile header (~64px). No
// "use client": it renders the same in either tree.
//
// The monogram disc is token-colored (primary-container / on-primary-
// container) — the one small identity mark for DJs whose provider sends no
// photo (Apple typically doesn't; email-path never does).

export type AvatarProps = {
  imageUrl: string | null;
  /** Fallback letter — first letter of DJ name, else email (D-4). */
  monogram: string;
  size: number;
  /** Empty by default: decorative next to its own text/label. */
  alt?: string;
};

export function Avatar({ imageUrl, monogram, size, alt = "" }: AvatarProps) {
  if (imageUrl) {
    return (
      <Image
        src={imageUrl}
        alt={alt}
        width={size}
        height={size}
        className="avatar-image"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden={alt === "" ? true : undefined}
      role={alt === "" ? undefined : "img"}
      aria-label={alt === "" ? undefined : alt}
      className="avatar-monogram"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}
    >
      {monogram}
    </span>
  );
}
