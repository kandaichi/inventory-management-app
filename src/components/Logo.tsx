import React from 'react';

export default function Logo({ size = 44, className = '' }: { size?: number; className?: string }) {
  const s = size;
  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      <svg width={s} height={s} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="rounded-full shadow-sm">
        <defs>
          <linearGradient id="g1" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#FBCFE8" />
            <stop offset="100%" stopColor="#FDE68A" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="14" fill="url(#g1)" />
        <text x="50%" y="53%" fontFamily="M PLUS Rounded 1c, sans-serif" fontWeight="700" fontSize="24" fill="#7F1D1D" textAnchor="middle" dominantBaseline="middle">クラ</text>
      </svg>
      <div className="flex flex-col leading-none">
        <span className="text-lg font-extrabold text-slate-800">クラボ</span>
        <span className="text-xs text-slate-400 -mt-0.5">家の在庫を、もっと素敵に。</span>
      </div>
    </div>
  );
}
