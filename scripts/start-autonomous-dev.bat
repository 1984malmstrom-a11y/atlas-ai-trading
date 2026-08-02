@echo off
set PAPER_TRADER_SCHEDULER_MODE=in_memory
node -e "console.log(process.env.PAPER_TRADER_SCHEDULER_MODE==='in_memory')"
npm run dev
