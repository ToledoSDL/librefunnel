import { headers } from "next/headers";
import { browserTags } from "@/lib/tracking/accounts";

// The vendors' own loaders, unchanged but for the ids. Under 'strict-dynamic' the scripts they add inherit this nonce's
// trust, so the policy needs no host list for them.
function metaLoader(pixelId: string) {
  return `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(pixelId)});fbq('track','PageView');`;
}

function tiktokLoader(pixelCode: string) {
  return `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=d.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=d.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};ttq.load(${JSON.stringify(pixelCode)});ttq.page();}(window,document,"ttq");`;
}

function googleLoader(ids: string[]) {
  return `window.dataLayer=window.dataLayer||[];window.gtag=function(){dataLayer.push(arguments)};gtag('js',new Date());${ids.map((id) => `gtag('config',${JSON.stringify(id)});`).join("")}`;
}

// The ad platforms' browser tags the seller turned on in Conexões, for buyer pages only; product is the page's product,
// whose own pixel replaces the store's.
export async function Tags({ product }: { product: string }) {
  const [tags, request] = await Promise.all([browserTags(product), headers()]);
  const nonce = /'nonce-([^']+)'/.exec(request.get("content-security-policy") ?? "")?.[1];
  if (!nonce) return null;

  return (
    <>
      {tags.google ? (
        <>
          <script
            async
            nonce={nonce}
            src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tags.google[0] ?? "")}`}
          />
          <script nonce={nonce} dangerouslySetInnerHTML={{ __html: googleLoader(tags.google) }} />
        </>
      ) : null}
      {tags.meta ? <script nonce={nonce} dangerouslySetInnerHTML={{ __html: metaLoader(tags.meta) }} /> : null}
      {tags.tiktok ? <script nonce={nonce} dangerouslySetInnerHTML={{ __html: tiktokLoader(tags.tiktok) }} /> : null}
    </>
  );
}
