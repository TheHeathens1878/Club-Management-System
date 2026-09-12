// Stand-in for next/link inside the Claude Design bundle: a plain anchor with
// the same props surface, so components that render Links work without the
// Next app router. Never used by the app itself.
import * as React from "react";

type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string | { pathname?: string; query?: Record<string, string> };
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  locale?: string | false;
  legacyBehavior?: boolean;
  passHref?: boolean;
};

function hrefString(href: LinkProps["href"]): string {
  if (typeof href === "string") return href;
  const q = href.query ? "?" + new URLSearchParams(href.query).toString() : "";
  return (href.pathname ?? "") + q;
}

const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, prefetch, replace, scroll, shallow, locale, legacyBehavior, passHref, onClick, ...rest },
  ref,
) {
  return (
    <a
      ref={ref}
      href={hrefString(href)}
      onClick={(event) => {
        onClick?.(event);
        // Inside a design preview a navigation would tear the frame away.
        event.preventDefault();
      }}
      {...rest}
    />
  );
});

export default Link;
