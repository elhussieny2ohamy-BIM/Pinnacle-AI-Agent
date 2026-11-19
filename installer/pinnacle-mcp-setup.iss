; =============================================================================
; PINNACLE MCP Servers - bundled installer (Inno Setup 6)
; -----------------------------------------------------------------------------
; Build:  .\build-installer.ps1
; The installer bundles setup.ps1, the setup/ stage scripts, the prebuilt
; release-assets/*.zip server archives, and pack-aec declarations, then runs
; the PowerShell pipeline in two passes:
;   1) elevated  -> runtimes (Node.js, .NET, uv)
;   2) user      -> servers, plugins, client configuration (Claude/ChatGPT/PINNACLE)
; The second pass runs as the original user so every per-user path
; (%LOCALAPPDATA%, %APPDATA%, ~/.dsh) resolves correctly.
; =============================================================================

#define AppName        "PINNACLE MCP Servers"
#define AppVersion     "1.1.0"
#define AppPublisher   "PINNACLE"
#define AppURL         "https://github.com/elhussieny2ohamy-BIM/Pinnacle-AI-Agent"
#define AppExeName     "Pinnacle-MCP-Setup"

[Setup]
AppId={{8F3C2A1E-7B4D-4C9A-9E2F-1A6B5C8D7E90}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
DefaultDirName={autopf}\PINNACLE\MCP-Setup
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
OutputDir=output
OutputBaseFilename={#AppExeName}-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
; SetupIconFile=..\Pinnacle-Logo.ico   ; uncomment when an .ico is available

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut to re-run the setup"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
; Root dispatcher + stage scripts
Source: "..\setup.ps1";        DestDir: "{app}"; Flags: ignoreversion
Source: "..\setup\*.ps1";      DestDir: "{app}\setup"; Flags: ignoreversion recursesubdirs createallsubdirs

; Bundled MCP server archives (offline install)
Source: "..\release-assets\*.zip"; DestDir: "{app}\release-assets"; Flags: ignoreversion

; AEC pack declarations (reference / PINNACLE fallback)
Source: "..\pack-aec\*"; DestDir: "{app}\pack-aec"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "node_modules\*,package-lock.json,pnpm-lock.yaml"

; Docs
Source: "..\README.md";  DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\PROJECT.md"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "..\opencode.example.json"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
; Re-run the full per-user configuration without reinstalling runtimes.
Name: "{group}\Re-run PINNACLE MCP Setup"; Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup.ps1"" -InstallDir ""{app}"" -SkipRuntimes -BundledAssetsDir ""{app}\release-assets"""; \
  WorkingDir: "{app}"; Comment: "Configure MCP servers for Claude, ChatGPT and PINNACLE"
Name: "{group}\Open setup log"; Filename: "{tmp}\pinnacle-mcp-setup.log"; Flags: createonlyiffileexists
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Re-run PINNACLE MCP Setup"; Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup.ps1"" -InstallDir ""{app}"" -SkipRuntimes -BundledAssetsDir ""{app}\release-assets"""; \
  WorkingDir: "{app}"; Tasks: desktopicon

[Run]
; Pass 1 (elevated): runtimes only.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup.ps1"" -InstallDir ""{app}"" -SkipServers -SkipPlugins -SkipClients -SkipVerify -LogPath ""{tmp}\pinnacle-mcp-setup.log"""; \
  StatusMsg: "Installing runtimes (Node.js, .NET Runtime, uv)..."; \
  Flags: waituntilterminated runhidden

; Pass 2 (original user): servers, plugins, and the three AI-agent configs.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup.ps1"" -InstallDir ""{app}"" -SkipRuntimes -BundledAssetsDir ""{app}\release-assets"" -LogPath ""{tmp}\pinnacle-mcp-setup.log"""; \
  StatusMsg: "Installing MCP servers and configuring Claude / ChatGPT / PINNACLE..."; \
  Flags: waituntilterminated runascurrentuser runhidden

[UninstallDelete]
Type: files; Name: "{app}\pinnacle-mcp-servers.json"
Type: files; Name: "{tmp}\pinnacle-mcp-setup.log"
