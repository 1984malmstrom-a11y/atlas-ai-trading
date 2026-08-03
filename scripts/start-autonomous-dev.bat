@echo off
set PAPER_TRADER_SCHEDULER_MODE=in_memory
set PAPER_TRADER_FOREX_AUTONOMY_ARMED=true
node -e "console.log('scheduler=' + (process.env.PAPER_TRADER_SCHEDULER_MODE==='in_memory') + ' armed=' + (process.env.PAPER_TRADER_FOREX_AUTONOMY_ARMED==='true'))"
npm run dev
