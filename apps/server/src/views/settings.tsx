import type { AppConfig } from "@wbz/core";
import { Layout } from "./layout.tsx";
import { PageHeader } from "./ui.tsx";

/** Read-only. Secrets are shown only as set / missing, never as values. */
export function SettingsPage(p: {
  config: AppConfig;
  secrets: [name: string, set: boolean, purpose: string][];
  environment: string;
  authMode: string;
}) {
  return (
    <Layout title="Settings" active="/settings">
      <PageHeader title="Settings" />
      <p class="muted">
        Read-only. Tunables come from <code>packages/core/src/config.ts</code>, overridden by the{" "}
        <code>APP_CONFIG</code> env var. Secrets are set with <code>wrangler secret put</code> (or <code>.env</code>{" "}
        locally).
      </p>
      <div class="grid">
        <section class="card">
          <h2>Environment</h2>
          <dl>
            <dt>ENVIRONMENT</dt>
            <dd>{p.environment}</dd>
            <dt>AUTH_MODE</dt>
            <dd>{p.authMode}</dd>
          </dl>
        </section>
        <section class="card">
          <h2>Secrets</h2>
          <table>
            <tbody>
              {p.secrets.map(([name, set, purpose]) => (
                <tr>
                  <th scope="row">
                    <code>{name}</code>
                  </th>
                  <td>{set ? <span class="badge succeeded">set</span> : <span class="badge dead">missing</span>}</td>
                  <td class="small muted">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <h2>Effective config</h2>
      <pre class="config">{JSON.stringify(p.config, null, 2)}</pre>
    </Layout>
  );
}
