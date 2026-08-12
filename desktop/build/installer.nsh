!include nsDialogs.nsh
!include LogicLib.nsh

Var CreateDesktopShortcutCheckbox
Var CreateDesktopShortcutState

!macro customPageAfterChangeDir
  !insertmacro skipPageIfUpdated
  Page custom CreateDesktopShortcutPageCreate CreateDesktopShortcutPageLeave
!macroend

Function CreateDesktopShortcutPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 24u "快捷方式"
  Pop $0
  ${NSD_CreateCheckbox} 0 34u 100% 14u "创建桌面快捷方式"
  Pop $CreateDesktopShortcutCheckbox
  ${NSD_Check} $CreateDesktopShortcutCheckbox
  nsDialogs::Show
FunctionEnd

Function CreateDesktopShortcutPageLeave
  ${NSD_GetState} $CreateDesktopShortcutCheckbox $CreateDesktopShortcutState
FunctionEnd

!macro customInstall
  ${If} $CreateDesktopShortcutState == ${BST_CHECKED}
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${EndIf}
!macroend

!macro customUnInstall
  WinShell::UninstShortcut "$oldDesktopLink"
  Delete "$oldDesktopLink"
!macroend
