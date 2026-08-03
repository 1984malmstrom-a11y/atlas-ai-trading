@echo off
set PAPER_TRADER_SCHEDULER_MODE=in_memory
set PAPER_TRADER_FOREX_AUTONOMY_ARMED=true
:: Use a per-developer lock namespace to avoid colliding with other runtimes
set PAPER_TRADER_LOCK_NAMESPACE=atlas-dev-%USERNAME%-%COMPUTERNAME%
node -e "console.log('scheduler=' + (process.env.PAPER_TRADER_SCHEDULER_MODE==='in_memory') + ' armed=' + (process.env.PAPER_TRADER_FOREX_AUTONOMY_ARMED==='true'))"
npm run dev
