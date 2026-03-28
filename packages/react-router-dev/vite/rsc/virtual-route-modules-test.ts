import { stripServerOnlyExportsForClientScan } from "./virtual-route-modules";

describe("stripServerOnlyExportsForClientScan", () => {
  test("removes loader-only imports from client-scanned route modules", () => {
    let result = stripServerOnlyExportsForClientScan(`
      import { getChat } from "@oddlynew/chat";
      import { Link } from "react-router";

      let serverOnly = () => getChat();
      let clientOnly = () => <Link to="/">Messages</Link>;

      export async function loader() {
        return serverOnly();
      }

      export default function MessagesRoute() {
        return clientOnly();
      }
    `);

    expect(result).not.toBeNull();
    expect(result!.code).toContain("export default function MessagesRoute()");
    expect(result!.code).toContain("react-router");
    expect(result!.code).not.toContain("@oddlynew/chat");
    expect(result!.code).not.toContain("export async function loader");
  });

  test("removes server-first exports and their imports from the client scan", () => {
    let result = stripServerOnlyExportsForClientScan(`
      import { getChat } from "@oddlynew/chat";
      import { getMeta } from "./meta";

      let serverOnly = () => getChat();
      let clientOnly = () => getMeta();

      export async function loader() {
        return serverOnly();
      }

      export function ServerComponent() {
        return <div>Server component</div>;
      }

      export const handle = {
        breadcrumb: "messages",
      };

      export function meta() {
        return clientOnly();
      }
    `);

    expect(result).not.toBeNull();
    expect(result!.code).toContain("export const handle");
    expect(result!.code).toContain("export function meta()");
    expect(result!.code).toContain("./meta");
    expect(result!.code).not.toContain("@oddlynew/chat");
    expect(result!.code).not.toContain("ServerComponent");
    expect(result!.code).not.toContain("export async function loader");
  });

  test("skips routes that already only expose client-visible exports", () => {
    expect(
      stripServerOnlyExportsForClientScan(`
        import { getMeta } from "./meta";

        export default function MessagesRoute() {
          return <div>Messages</div>;
        }

        export function meta() {
          return getMeta();
        }
      `),
    ).toBeNull();
  });
});
