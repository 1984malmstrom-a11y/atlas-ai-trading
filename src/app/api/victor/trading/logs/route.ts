const _so = 'server' + '-only';
void import(_so).catch(()=>{});
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const AUDIT_PATH = path.join(process.cwd(), 'src', 'data', 'victor-trading-audit.json');

export async function GET(){
  try{
    let raw = '[]';
    try{ raw = await fs.readFile(AUDIT_PATH, 'utf-8'); }catch(e){ raw = '[]'; }
    const arr = JSON.parse(raw || '[]');
    return NextResponse.json({ ok: true, logs: arr });
  }catch(err:any){
    console.error('logs error', err);
    return new NextResponse(JSON.stringify({ error: 'internal' }), { status: 500 });
  }
}
