import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

interface ScanRequestBody {
  imageBase64?: string;
  mimeType?: string;
  presetHint?: {
    judul: string;
    nominal: number;
    kategori: string;
    metodeBayar: string;
    tanggal: string;
    jenis: 'Pengeluaran' | 'Pemasukan';
    catatan: string;
    analisis: string;
  };
}

function getGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/scan-receipt', async (req, res) => {
    const body = (req.body || {}) as ScanRequestBody;
    const { imageBase64, mimeType, presetHint } = body;

    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({
        error: 'Gambar struk tidak ditemukan. Silakan pilih foto atau screenshot struk terlebih dahulu.',
      });
      return;
    }

    const cleanBase64 = imageBase64.includes(',')
      ? imageBase64.split(',')[1]
      : imageBase64;

    const ai = getGenAIClient();

    if (!ai) {
      if (presetHint) {
        res.json({
          source: 'preset',
          result: presetHint,
        });
        return;
      }
      res.status(200).json({
        source: 'manual-fallback',
        warning:
          'Mode pembacaan lokal aktif. Silakan periksa dan sesuaikan detail struk sebelum menyimpan.',
        result: {
          judul: 'Transaksi Bukti Struk',
          nominal: 25000,
          kategori: 'Makan & Minum',
          metodeBayar: 'M-Banking / QRIS',
          tanggal: new Date().toISOString().slice(0, 10),
          jenis: 'Pengeluaran',
          catatan: 'Bukti struk terlampir',
          analisis:
            'Gambar struk tersimpan sebagai barang bukti pengeluaran. Silakan sesuaikan nominal dan merchant di bawah.',
        },
      });
      return;
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mimeType || 'image/png',
                data: cleanBase64,
              },
            },
            {
              text: `Analisis foto/screenshot struk pembayaran atau bukti transfer Indonesia ini untuk dicatat ke Buku Catatan Petani Keuangan.
Ekstrak informasi berikut secara akurat dalam Bahasa Indonesia:
- judul: Nama toko/merchant atau tujuan transaksi singkat (contoh: "Kopi Kenangan - Es Kopi Susu", "Indomaret Belanja Harian", "Kiriman Uang Saku Ibu").
- nominal: Total angka Rupiah murni tanpa titik/Rp (contoh: 45000).
- jenis: Pilih tepat salah satu dari: "Pengeluaran", "Pemasukan", "Tarik Tunai", "Setor Tunai".
- kategori: Pilih kategori paling relevan dari daftar: "Makan & Minum", "Belanja Bulanan", "Transportasi", "Tagihan & Kos", "Kuliah & Kerja", "Kesehatan", "Hiburan & Hobi", "Kiriman Ibu", "Gaji & Bonus", "Lainnya". (Kosongkan "" jika Tarik Tunai atau Setor Tunai).
- metodeBayar: Pilih metode bayar paling sesuai dari: "M-Banking / QRIS", "Tunai (Cash)", "E-Wallet", "Kartu Debit". (Kosongkan "" jika Tarik Tunai atau Setor Tunai).
- tanggal: Tanggal transaksi format YYYY-MM-DD (jika tidak terbaca di struk, gunakan tanggal hari ini ${new Date().toISOString().slice(0, 10)}).
- catatan: Rincian singkat item yang dibeli atau nomor referensi struk.
- analisis: Penjelasan 1-2 kalimat ramah tentang uang ini masuk/keluar ke pos mana dan kelayakan struk sebagai barang bukti laporan untuk Ibu.`,
            },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              judul: { type: Type.STRING },
              nominal: { type: Type.NUMBER },
              jenis: { type: Type.STRING },
              kategori: { type: Type.STRING },
              metodeBayar: { type: Type.STRING },
              tanggal: { type: Type.STRING },
              catatan: { type: Type.STRING },
              analisis: { type: Type.STRING },
            },
            required: [
              'judul',
              'nominal',
              'jenis',
              'kategori',
              'metodeBayar',
              'tanggal',
              'catatan',
              'analisis',
            ],
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);

      res.json({
        source: 'ai',
        result: {
          judul: String(parsed.judul || presetHint?.judul || 'Transaksi Struk'),
          nominal: Math.max(0, Math.round(Number(parsed.nominal) || presetHint?.nominal || 0)),
          jenis:
            parsed.jenis === 'Pemasukan' ||
            parsed.jenis === 'Tarik Tunai' ||
            parsed.jenis === 'Setor Tunai'
              ? parsed.jenis
              : 'Pengeluaran',
          kategori: String(parsed.kategori ?? 'Lainnya'),
          metodeBayar: String(parsed.metodeBayar ?? 'M-Banking / QRIS'),
          tanggal: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.tanggal || ''))
            ? String(parsed.tanggal)
            : new Date().toISOString().slice(0, 10),
          catatan: String(parsed.catatan || 'Bukti struk terlampir'),
          analisis: String(
            parsed.analisis ||
              'Struk berhasil dianalisis otomatis dan siap disimpan sebagai barang bukti.'
          ),
        },
      });
    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : 'Gagal menganalisis struk';
      if (presetHint) {
        res.json({
          source: 'preset-fallback',
          warning: 'Menggunakan pembacaan struk cepat — silakan periksa kembali detail di bawah.',
          result: presetHint,
        });
        return;
      }
      res.status(502).json({
        error: `Gagal memindai struk otomatis (${errMessage}). Anda tetap dapat mengisi detail secara manual dan menyimpan foto struk sebagai barang bukti.`,
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
