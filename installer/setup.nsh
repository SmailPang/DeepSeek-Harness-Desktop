!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef WM_COMMAND
  !define WM_COMMAND 0x0111
!endif
!ifndef WM_SETTEXT
  !define WM_SETTEXT 0x000C
!endif

!ifndef IDC_HEADER_TITLE
  !define IDC_HEADER_TITLE 1025
!endif
!ifndef IDC_HEADER_SUBTITLE
  !define IDC_HEADER_SUBTITLE 1026
!endif

!ifndef BUILD_UNINSTALLER
Var DlgDsh
Var DlgMarket
Var DshState
Var MarketState

Function DshComponentsPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  GetDlgItem $9 $HWNDPARENT ${IDC_HEADER_TITLE}
  SendMessage $9 ${WM_SETTEXT} 0 "STR:选择组件"
  GetDlgItem $9 $HWNDPARENT ${IDC_HEADER_SUBTITLE}
  SendMessage $9 ${WM_SETTEXT} 0 "STR:选择需要一并自动安装的组件"

  ${NSD_CreateLabel} 0u 0u 100% 28u "本程序只是 DeepSeek Harness（dsh）的桌面外壳，$\r$\n额外提供以下组件的一键安装，均可自由勾选："
  Pop $1

  ${NSD_CreateCheckBox} 0u 34u 100% 12u "DeepSeek Harness"
  Pop $DlgDsh
  ${NSD_Check} $DlgDsh

  ${NSD_CreateCheckBox} 0u 56u 100% 12u "插件商店 dshmarket"
  Pop $DlgMarket
  ${NSD_Check} $DlgMarket

  ${NSD_CreateLabel} 0u 78u 100% 42u "说明：不勾选 DeepSeek Harness 时，请先自行安装 dsh$\r$\n（npm install -g @deepseek-ai/dsh），否则桌面外壳无法启动；$\r$\n插件商店也可日后在 dsh 中自行安装。"
  Pop $1

  nsDialogs::Show
FunctionEnd

Function DshComponentsPageLeave
  ${NSD_GetState} $DlgDsh $DshState
  ${NSD_GetState} $DlgMarket $MarketState
FunctionEnd

!macro customComponentsPage
  Page custom DshComponentsPageCreate DshComponentsPageLeave
!macroend

!macro customInstall
  ${If} $DshState == ""
    StrCpy $DshState 0
  ${EndIf}
  ${If} $MarketState == ""
    StrCpy $MarketState 0
  ${EndIf}
  DetailPrint "正在按选择检查并安装 dsh 与插件，可能需要几分钟..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\setup\postinstall.ps1" -InstallDsh $DshState -InstallMarket $MarketState'
  Pop $0
  ${If} $0 == 10
    MessageBox MB_OK|MB_ICONSTOP "未检测到 Node.js / npm。$\r$\n$\r$\n请先安装 Node.js LTS（https://nodejs.org/），再重新运行本安装程序。"
  ${ElseIf} $0 == 11
    MessageBox MB_OK|MB_ICONSTOP "dsh 自动安装失败。$\r$\n请检查网络后手动执行：npm install -g @deepseek-ai/dsh$\r$\n日志：$TEMP\dsh-desktop-setup.log"
  ${ElseIf} $0 == 12
    MessageBox MB_OK|MB_ICONEXCLAMATION "插件商店 dshmarket 安装失败，桌面外壳不受影响。$\r$\n可稍后手动执行：dsh plugin --profile web add dshmarket$\r$\n日志：$TEMP\dsh-desktop-setup.log"
  ${ElseIf} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "组件安装步骤出现异常（错误码 $0），桌面外壳已安装完成。$\r$\n日志：$TEMP\dsh-desktop-setup.log"
  ${EndIf}
!macroend
!endif

!ifdef BUILD_UNINSTALLER
Var DlgUnDsh
Var UnDshState

Function un.DshUninstallPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  GetDlgItem $9 $HWNDPARENT ${IDC_HEADER_TITLE}
  SendMessage $9 ${WM_SETTEXT} 0 "STR:卸载选项"
  GetDlgItem $9 $HWNDPARENT ${IDC_HEADER_SUBTITLE}
  SendMessage $9 ${WM_SETTEXT} 0 "STR:选择卸载范围"

  ${NSD_CreateLabel} 0u 0u 100% 30u "即将卸载 DeepSeek Harness 桌面外壳及其快捷方式。$\r$\n可同时选择是否移除全局安装的 dsh 命令行与插件："
  Pop $1

  ${NSD_CreateCheckBox} 0u 40u 100% 24u "同时卸载全局安装的 DeepSeek Harness（dsh）$\r$\n（将执行 npm uninstall -g @deepseek-ai/dsh）"
  Pop $DlgUnDsh

  ${NSD_CreateLabel} 0u 74u 100% 42u "注意：dsh 是全局 npm 包，若其他项目或工具也在使用它，$\r$\n请不要勾选。不勾选则仅移除桌面外壳，dsh 与已安装插件保留。"
  Pop $1

  nsDialogs::Show
FunctionEnd

Function un.DshUninstallPageLeave
  ${NSD_GetState} $DlgUnDsh $UnDshState
FunctionEnd

!macro customUnWelcomePage
  UninstPage custom un.DshUninstallPageCreate un.DshUninstallPageLeave
!macroend

!macro customUnInstall
  ${If} $UnDshState == "1"
    DetailPrint "正在卸载全局 dsh ..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\setup\uninstall-dsh.ps1"'
    Pop $0
    ${If} $0 != 0
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONEXCLAMATION "全局 dsh 卸载失败（错误码 $0），桌面外壳仍会被移除。$\r$\n可手动执行：npm uninstall -g @deepseek-ai/dsh$\r$\n日志：$TEMP\dsh-desktop-setup.log"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
!endif


