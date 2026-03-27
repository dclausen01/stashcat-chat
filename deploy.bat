@echo off
cd /d "C:\Users\claud\OneDrive\Projekte\stashcat-chat"
call npm run build > deploy_out.txt 2>&1
echo BUILD_EXIT:%ERRORLEVEL% >> deploy_out.txt
git -C "C:\Users\claud\OneDrive\Projekte\stashcat-chat" add src/components/ChatView.tsx src/components/NotificationsPanel.tsx src/components/CreatePollModal.tsx src/components/PollsView.tsx src/api.ts src/App.tsx CLAUDE.md >> deploy_out.txt 2>&1
git -C "C:\Users\claud\OneDrive\Projekte\stashcat-chat" commit -m "feat: filled like badge, poll notifications, invite hint, company_id fix" >> deploy_out.txt 2>&1
echo COMMIT_EXIT:%ERRORLEVEL% >> deploy_out.txt
git -C "C:\Users\claud\OneDrive\Projekte\stashcat-chat" push >> deploy_out.txt 2>&1
echo PUSH_EXIT:%ERRORLEVEL% >> deploy_out.txt
