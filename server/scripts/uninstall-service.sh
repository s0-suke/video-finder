#!/bin/bash
# 常駐サービスを停止して登録を解除する
LABEL="local.videofinder"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "解除しました"
