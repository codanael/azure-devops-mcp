{
  description = "Azure DevOps MCP Server — development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          # Node 22 matches the @types/node major used by the project and
          # satisfies the README's "Node.js 20+" requirement. All other
          # tooling (tsc, eslint, prettier, jest, husky, shx) is provided
          # through the project's devDependencies via `npm install`.
          packages = with pkgs; [
            nodejs_22
            git
          ];

          shellHook = ''
            echo "azure-devops-mcp dev shell"
            echo "  node $(node --version), npm $(npm --version)"
            echo "  run 'npm install' then 'npm run build' / 'npm test'"
          '';
        };
      }
    );
}
