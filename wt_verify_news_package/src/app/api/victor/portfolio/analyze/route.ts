import analyzePortfolio from '../../../../../domain/portfolio/victor-portfolio-intelligence-engine';
import { NextResponse } from 'next/server';

export async function POST(req: Request){
  try{
    const body = await req.json();
    const { portfolio, investorProfile, memoryContext } = body || {};
    if (!portfolio || !Array.isArray(portfolio.holdings)) return new NextResponse('Invalid portfolio', { status: 400 });
    // protect against huge payloads
    if ((portfolio.holdings.length || 0) > 2000) return new NextResponse('Payload too large', { status: 400 });

    const report = await analyzePortfolio(portfolio, { investorProfile, memoryContext });
    return NextResponse.json(report);
  }catch(e:any){
    // server-side log
    console.error('Victor portfolio analyze error:', e?.message || e);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
