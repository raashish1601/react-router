import type * as Vite from "vite";
import * as babel from "../babel";
import { parse as esModuleLexer } from "es-module-lexer";
import { removeExports } from "../remove-exports";

const SERVER_ONLY_COMPONENT_EXPORTS = ["ServerComponent"] as const;

const SERVER_ONLY_ROUTE_EXPORTS = [
  ...SERVER_ONLY_COMPONENT_EXPORTS,
  "loader",
  "action",
  "middleware",
  "headers",
] as const;
type ServerOnlyRouteExport = (typeof SERVER_ONLY_ROUTE_EXPORTS)[number];
const SERVER_ONLY_ROUTE_EXPORTS_SET = new Set(SERVER_ONLY_ROUTE_EXPORTS);
function isServerOnlyRouteExport(name: string): name is ServerOnlyRouteExport {
  return SERVER_ONLY_ROUTE_EXPORTS_SET.has(name as ServerOnlyRouteExport);
}

const COMMON_COMPONENT_EXPORTS = [
  "ErrorBoundary",
  "HydrateFallback",
  "Layout",
] as const;

const SERVER_FIRST_COMPONENT_EXPORTS = [
  ...COMMON_COMPONENT_EXPORTS,
  ...SERVER_ONLY_COMPONENT_EXPORTS,
] as const;
type ServerFirstComponentExport =
  (typeof SERVER_FIRST_COMPONENT_EXPORTS)[number];
const SERVER_FIRST_COMPONENT_EXPORTS_SET = new Set(
  SERVER_FIRST_COMPONENT_EXPORTS,
);
function isServerFirstComponentExport(
  name: string,
): name is ServerFirstComponentExport {
  return SERVER_FIRST_COMPONENT_EXPORTS_SET.has(
    name as ServerFirstComponentExport,
  );
}

const CLIENT_COMPONENT_EXPORTS = [
  ...COMMON_COMPONENT_EXPORTS,
  "default",
] as const;

export const CLIENT_NON_COMPONENT_EXPORTS = [
  "clientAction",
  "clientLoader",
  "clientMiddleware",
  "handle",
  "meta",
  "links",
  "shouldRevalidate",
] as const;
type ClientNonComponentExport = (typeof CLIENT_NON_COMPONENT_EXPORTS)[number];
const CLIENT_NON_COMPONENT_EXPORTS_SET = new Set(CLIENT_NON_COMPONENT_EXPORTS);
function isClientNonComponentExport(
  name: string,
): name is ClientNonComponentExport {
  return CLIENT_NON_COMPONENT_EXPORTS_SET.has(name as ClientNonComponentExport);
}

const CLIENT_ROUTE_EXPORTS = [
  ...CLIENT_NON_COMPONENT_EXPORTS,
  ...CLIENT_COMPONENT_EXPORTS,
] as const;
type ClientRouteExport = (typeof CLIENT_ROUTE_EXPORTS)[number];
const CLIENT_ROUTE_EXPORTS_SET = new Set(CLIENT_ROUTE_EXPORTS);
function isClientRouteExport(name: string): name is ClientRouteExport {
  return CLIENT_ROUTE_EXPORTS_SET.has(name as ClientRouteExport);
}

const ROUTE_EXPORTS = [
  ...SERVER_ONLY_ROUTE_EXPORTS,
  ...CLIENT_ROUTE_EXPORTS,
] as const;
type RouteExport = (typeof ROUTE_EXPORTS)[number];
const ROUTE_EXPORTS_SET = new Set(ROUTE_EXPORTS);
function isRouteExport(name: string): name is RouteExport {
  return ROUTE_EXPORTS_SET.has(name as RouteExport);
}
function isCustomRouteExport(name: string) {
  return !isRouteExport(name);
}

function hasReactServerCondition(viteEnvironment: Vite.Environment) {
  return viteEnvironment.config.resolve.conditions.includes("react-server");
}

type ViteCommand = Vite.ConfigEnv["command"];

export function transformVirtualRouteModules({
  id,
  code,
  viteCommand,
  routeIdByFile,
  rootRouteFile,
  viteEnvironment,
}: {
  id: string;
  code: string;
  viteCommand: ViteCommand;
  routeIdByFile: Map<string, string>;
  rootRouteFile: string;
  viteEnvironment: Vite.Environment;
}) {
  if (isVirtualRouteModuleId(id) || routeIdByFile.has(id)) {
    return createVirtualRouteModuleCode({
      id,
      code,
      rootRouteFile,
      viteCommand,
      viteEnvironment,
    });
  }

  if (isVirtualServerRouteModuleId(id)) {
    return createVirtualServerRouteModuleCode({
      id,
      code,
      viteEnvironment,
    });
  }

  if (isVirtualClientRouteModuleId(id)) {
    return createVirtualClientRouteModuleCode({
      id,
      code,
      rootRouteFile,
      viteCommand,
    });
  }
}

async function createVirtualRouteModuleCode({
  id,
  code: routeSource,
  rootRouteFile,
  viteCommand,
  viteEnvironment,
}: {
  id: string;
  code: string;
  rootRouteFile: string;
  viteCommand: ViteCommand;
  viteEnvironment: Vite.Environment;
}) {
  const isReactServer = hasReactServerCondition(viteEnvironment);
  const { staticExports, isServerFirstRoute, hasClientExports } =
    parseRouteExports(routeSource);

  const clientModuleId = getVirtualClientModuleId(id);
  const serverModuleId = getVirtualServerModuleId(id);

  let code = "";
  if (isServerFirstRoute) {
    if (staticExports.some(isServerFirstComponentExport)) {
      code += `import React from "react";\n`;
    }
    for (const staticExport of staticExports) {
      if (isClientNonComponentExport(staticExport)) {
        code += `export { ${staticExport} } from "${clientModuleId}";\n`;
      } else if (
        isReactServer &&
        isServerFirstComponentExport(staticExport) &&
        // Layout wraps all other component exports so doesn't need CSS injected
        staticExport !== "Layout"
      ) {
        code += `import { ${staticExport} as ${staticExport}WithoutCss } from "${serverModuleId}";\n`;
        code += `export ${staticExport === "ServerComponent" ? "default " : " "}function ${staticExport}(props) {\n`;
        code += `  return React.createElement(React.Fragment, null,\n`;
        code += `    import.meta.viteRsc.loadCss(),\n`;
        code += `    React.createElement(${staticExport}WithoutCss, props),\n`;
        code += `  );\n`;
        code += `}\n`;
      } else if (isReactServer && isRouteExport(staticExport)) {
        code += `export { ${staticExport} } from "${serverModuleId}";\n`;
      } else if (isCustomRouteExport(staticExport)) {
        code += `export { ${staticExport} } from "${isReactServer ? serverModuleId : clientModuleId}";\n`;
      }
    }
    if (viteCommand === "serve" && !hasClientExports) {
      code += `export { __ensureClientRouteModuleForHMR } from "${clientModuleId}";\n`;
    }
  } else {
    for (const staticExport of staticExports) {
      if (isClientRouteExport(staticExport)) {
        code += `export { ${staticExport} } from "${clientModuleId}";\n`;
      } else if (isReactServer && isServerOnlyRouteExport(staticExport)) {
        code += `export { ${staticExport} } from "${serverModuleId}";\n`;
      } else if (isCustomRouteExport(staticExport)) {
        code += `export { ${staticExport} } from "${isReactServer ? serverModuleId : clientModuleId}";\n`;
      }
    }
  }

  if (
    isRootRouteFile({ id, rootRouteFile }) &&
    !staticExports.includes("ErrorBoundary")
  ) {
    code += `export { ErrorBoundary } from "${clientModuleId}";\n`;
  }

  return code;
}

function createVirtualServerRouteModuleCode({
  id,
  code: routeSource,
  viteEnvironment,
}: {
  id: string;
  code: string;
  viteEnvironment: Vite.Environment;
}) {
  if (!hasReactServerCondition(viteEnvironment)) {
    throw new Error(
      [
        "Virtual server route module was loaded outside of the RSC environment.",
        `Environment Name: ${viteEnvironment.name}`,
        `Module ID: ${id}`,
      ].join("\n"),
    );
  }

  const { staticExports, isServerFirstRoute } = parseRouteExports(routeSource);
  const clientModuleId = getVirtualClientModuleId(id);
  const serverRouteModuleAst = babel.parse(routeSource, {
    sourceType: "module",
  });
  removeExports(
    serverRouteModuleAst,
    isServerFirstRoute ? CLIENT_NON_COMPONENT_EXPORTS : CLIENT_ROUTE_EXPORTS,
  );

  const generatorResult = babel.generate(serverRouteModuleAst);

  if (!isServerFirstRoute) {
    for (const staticExport of staticExports) {
      if (isClientRouteExport(staticExport)) {
        generatorResult.code += "\n";
        generatorResult.code += `export { ${staticExport} } from "${clientModuleId}";\n`;
      }
    }
  }

  return generatorResult;
}

function createVirtualClientRouteModuleCode({
  id,
  code: routeSource,
  rootRouteFile,
  viteCommand,
}: {
  id: string;
  code: string;
  rootRouteFile: string;
  viteCommand: ViteCommand;
}) {
  const { staticExports, isServerFirstRoute, hasClientExports } =
    parseRouteExports(routeSource);
  const exportsToRemove = getClientRouteModuleExportsToRemove({
    isServerFirstRoute,
  });

  const clientRouteModuleAst = babel.parse(routeSource, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
  removeExports(clientRouteModuleAst, exportsToRemove);

  const generatorResult = babel.generate(clientRouteModuleAst);
  generatorResult.code = '"use client";' + generatorResult.code;

  if (
    isRootRouteFile({ id, rootRouteFile }) &&
    !staticExports.includes("ErrorBoundary")
  ) {
    const hasRootLayout = staticExports.includes("Layout");
    generatorResult.code += `\nimport { createElement as __rr_createElement } from "react";\n`;
    generatorResult.code += `import { UNSAFE_RSCDefaultRootErrorBoundary } from "react-router";\n`;
    generatorResult.code += `export function ErrorBoundary() {\n`;
    generatorResult.code += `  return __rr_createElement(UNSAFE_RSCDefaultRootErrorBoundary, { hasRootLayout: ${hasRootLayout} });\n`;
    generatorResult.code += `}\n`;
  }

  if (viteCommand === "serve" && isServerFirstRoute && !hasClientExports) {
    generatorResult.code += `\nexport const __ensureClientRouteModuleForHMR = true;`;
  }

  return generatorResult;
}

export function stripServerOnlyExportsForClientScan(routeSource: string) {
  const {
    ast: clientRouteModuleAst,
    staticExports,
    isServerFirstRoute,
  } = parseRawRouteExports(routeSource);

  if (
    !isServerFirstRoute &&
    !staticExports.some((staticExport) => isServerOnlyRouteExport(staticExport))
  ) {
    return null;
  }

  removeExports(
    clientRouteModuleAst,
    getClientRouteModuleExportsToRemove({ isServerFirstRoute }),
  );

  return babel.generate(clientRouteModuleAst);
}

export function parseRouteExports(code: string) {
  const [, exportSpecifiers] = esModuleLexer(code);
  const staticExports = exportSpecifiers.map(({ n: name }) => name);
  const isServerFirstRoute = staticExports.some(
    (staticExport) => staticExport === "ServerComponent",
  );
  return {
    staticExports,
    isServerFirstRoute,
    hasClientExports: staticExports.some(
      isServerFirstRoute ? isClientNonComponentExport : isClientRouteExport,
    ),
  };
}

function getVirtualClientModuleId(id: string): string {
  return `${id.split("?")[0]}?client-route-module`;
}

function getVirtualServerModuleId(id: string): string {
  return `${id.split("?")[0]}?server-route-module`;
}

function isVirtualRouteModuleId(id: string): boolean {
  return /(\?|&)route-module(&|$)/.test(id);
}

export function isVirtualClientRouteModuleId(id: string): boolean {
  return /(\?|&)client-route-module(&|$)/.test(id);
}

function isVirtualServerRouteModuleId(id: string): boolean {
  return /(\?|&)server-route-module(&|$)/.test(id);
}

function isRootRouteFile({
  id,
  rootRouteFile,
}: {
  id: string;
  rootRouteFile: string;
}): boolean {
  const filePath = id.split("?")[0];
  return filePath === rootRouteFile;
}

function getClientRouteModuleExportsToRemove({
  isServerFirstRoute,
}: {
  isServerFirstRoute: boolean;
}) {
  return isServerFirstRoute
    ? [...SERVER_ONLY_ROUTE_EXPORTS, ...CLIENT_COMPONENT_EXPORTS]
    : SERVER_ONLY_ROUTE_EXPORTS;
}

function parseRawRouteExports(code: string) {
  const ast = babel.parse(code, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });
  const staticExports: string[] = [];

  babel.traverse(ast, {
    ExportNamedDeclaration(path) {
      if (path.node.exportKind === "type") return;

      if (path.node.declaration) {
        for (const name of getExportDeclarationNames(path.node.declaration)) {
          staticExports.push(name);
        }
      }

      for (const specifier of path.node.specifiers) {
        if (
          specifier.type !== "ExportSpecifier" ||
          specifier.exportKind === "type"
        ) {
          continue;
        }

        staticExports.push(
          specifier.exported.type === "Identifier"
            ? specifier.exported.name
            : specifier.exported.value,
        );
      }
    },
    ExportDefaultDeclaration() {
      staticExports.push("default");
    },
  });

  return {
    ast,
    staticExports,
    isServerFirstRoute: staticExports.includes("ServerComponent"),
  };
}

function getExportDeclarationNames(
  declaration: babel.Babel.Statement,
): string[] {
  switch (declaration.type) {
    case "VariableDeclaration":
      return declaration.declarations.flatMap((entry) =>
        getBindingNames(entry.id),
      );
    case "FunctionDeclaration":
    case "ClassDeclaration":
      return declaration.id ? [declaration.id.name] : [];
    default:
      return [];
  }
}

function getBindingNames(pattern: babel.Babel.LVal): string[] {
  switch (pattern.type) {
    case "Identifier":
      return [pattern.name];
    case "ObjectPattern":
      return pattern.properties.flatMap((property) => {
        if (property.type === "ObjectProperty") {
          return getBindingNames(property.value as babel.Babel.LVal);
        }

        return getBindingNames(property.argument);
      });
    case "ArrayPattern":
      return pattern.elements.flatMap((element) =>
        element ? getBindingNames(element) : [],
      );
    case "AssignmentPattern":
      return getBindingNames(pattern.left);
    case "RestElement":
      return getBindingNames(pattern.argument);
    default:
      return [];
  }
}
