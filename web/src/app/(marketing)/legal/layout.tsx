export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <article className="container max-w-3xl py-16 sm:py-20 [&_h1]:mb-2 [&_h1]:text-3xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-3 [&_p]:leading-relaxed [&_p]:text-muted-foreground [&_ul]:mb-3 [&_ul]:space-y-1 [&_ul]:text-muted-foreground">
      {children}
    </article>
  );
}
