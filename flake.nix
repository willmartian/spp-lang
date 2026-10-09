{
  description = "Spec++: a superset of Gherkin that you can run without step definitions";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      # Playwright downloads its own Chromium, which expects an FHS system.
      # nix-ld runs it; this hands nix-ld the libraries it links against.
      devShells.${system}.default = pkgs.mkShell {
        packages = [ pkgs.nodejs_22 ];
        NIX_LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath (with pkgs; [
          glib nss nspr dbus atk at-spi2-atk at-spi2-core cups libdrm expat
          libxkbcommon mesa libgbm alsa-lib pango cairo udev
          libx11 libxcomposite libxdamage libxext libxfixes libxrandr libxcb
        ]);
      };
    };
}
