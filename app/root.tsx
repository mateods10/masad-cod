import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

export default function App() {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
        <style>{`
          body { margin: 0; font-family: Inter, system-ui, sans-serif; color: #202223; }
          .ga-admin-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
          .ga-admin-grid label { display: grid; gap: 6px; font-weight: 600; }
          .ga-admin-grid input, .ga-admin-grid select, s-section input, s-section select { min-height: 38px; border: 1px solid #c9cccf; border-radius: 8px; padding: 7px 10px; font: inherit; box-sizing: border-box; }
          .ga-admin-table { width: 100%; border-collapse: collapse; }
          .ga-admin-table th, .ga-admin-table td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e1e3e5; white-space: nowrap; }
          .ga-admin-table th { font-size: 12px; color: #6d7175; text-transform: uppercase; }
          .ga-pixel-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
          .ga-pixel-heading h2 { margin: 0 0 4px; font-size: 20px; }
          .ga-pixel-heading p { margin: 0; color: #616161; }
          .ga-pixel-list { display: grid; gap: 10px; margin-top: 16px; }
          .ga-pixel-row { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(180px, 1.25fr) minmax(150px, .8fr) auto; gap: 14px; align-items: center; padding: 14px 16px; border: 1px solid #d8d8d8; border-radius: 14px; background: #fff; }
          .ga-pixel-platform { display: flex; align-items: center; gap: 10px; font-weight: 700; }
          .ga-pixel-logo { width: 26px; height: 26px; border-radius: 7px; display: inline-grid; place-items: center; color: #fff; font-weight: 800; }
          .ga-pixel-logo.meta { background: #1689e8; }
          .ga-pixel-logo.tiktok { background: #111; }
          .ga-pixel-id { color: #626262; overflow-wrap: anywhere; }
          .ga-pixel-status { display: inline-flex; width: fit-content; padding: 4px 9px; border-radius: 999px; background: #dff7e5; color: #176b2c; font-size: 12px; font-weight: 700; }
          .ga-pixel-status.off { background: #eee; color: #555; }
          .ga-pixel-actions { display: flex; gap: 6px; justify-content: flex-end; }
          .ga-pixel-form { margin-top: 16px; padding: 16px; border: 1px solid #d8d8d8; border-radius: 14px; background: #f8f8f8; }
          .ga-test-event-button { min-height: 36px; padding: 7px 13px; border: 1px solid #8a8a8a; border-radius: 8px; background: #fff; color: #202223; font: inherit; font-weight: 650; cursor: pointer; }
          .ga-test-event-button:hover { background: #f1f1f1; }
          .ga-event-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-top: 14px; }
          .ga-event-grid label { display: flex; align-items: center; gap: 8px; font-weight: 600; }
          .ga-event-grid input { width: 18px; height: 18px; }
          .ga-event-table { margin-top: 18px; padding: 16px; border: 1px solid #d8d8d8; border-radius: 14px; background: #fff; }
          .ga-event-table h3 { margin: 0 0 12px; font-size: 16px; }
          .ga-muted { color: #6d7175; font-size: 13px; }
          .ga-form-error { margin: 12px 0 0; padding: 10px 12px; border-radius: 8px; background: #fff0f0; color: #9a1515; }
          @media (max-width: 720px) { .ga-pixel-row { grid-template-columns: 1fr; } .ga-pixel-actions { justify-content: flex-start; } }
        `}</style>
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
