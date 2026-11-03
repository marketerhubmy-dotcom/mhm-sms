import { Link } from 'react-router-dom';
import { CatalogBrowser } from '../components/Catalog';
import { useSession } from '../lib/session';

export function Home() {
  const { user, config } = useSession();
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <span className="eyebrow">Nombor sementara · Harga dalam RM</span>
            <h1>Terima SMS pengesahan tanpa dedahkan nombor peribadi.</h1>
            <p className="lead">
              Pilih negara dan servis, bayar per pesanan melalui FPX, dan dapatkan nombor maya sementara untuk menerima kod SMS. Tiada langganan, tiada dompet tambahan.
            </p>
            <div className="row" style={{ marginTop: 22 }}>
              <Link className="btn btn-primary" to={user ? '/akaun' : '/daftar'}>
                {user ? 'Beli Nombor' : 'Daftar Percuma'}
              </Link>
              <Link className="btn btn-ghost" style={{ color: '#fff', borderColor: '#2c4672' }} to="/harga">
                Lihat Harga & Stok
              </Link>
            </div>
            {config && !config.salesOpen && (
              <div className="alert alert-warn small" style={{ marginTop: 18, maxWidth: 520 }}>
                Pembelian belum dibuka buat masa ini. Anda boleh mendaftar dan melihat harga terlebih dahulu.
              </div>
            )}
          </div>
          <div className="phone-mock" aria-label="Contoh paparan (ilustrasi)">
            <div className="row between">
              <span className="small" style={{ color: '#9fb3d1' }}>Contoh paparan</span>
              <span className="badge badge-ok">Menunggu SMS</span>
            </div>
            <div className="num" style={{ marginTop: 10 }}>+60 1X-XXX XXXX</div>
            <div className="small" style={{ color: '#9fb3d1' }}>Telegram · Malaysia · 14:32 lagi</div>
            <div className="sms">
              <div className="small muted">SMS diterima</div>
              <div className="code">482 913</div>
            </div>
            <div className="small" style={{ color: '#6f82a1', marginTop: 10 }}>Ilustrasi sahaja — bukan nombor sebenar.</div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Cara ia berfungsi</h2>
          <div className="grid grid-4" style={{ marginTop: 18 }}>
            {[
              ['Pilih', 'Pilih negara dan servis. Stok dan harga dipaparkan sebelum anda bayar.'],
              ['Bayar', 'Bayar untuk pesanan itu sahaja. Bayaran disahkan oleh sistem sebelum nombor ditempah.'],
              ['Guna nombor', 'Salin nombor dan masukkan di aplikasi atau laman yang meminta pengesahan.'],
              ['Terima kod', 'SMS yang masuk dipaparkan di akaun anda dalam tempoh aktif nombor.'],
            ].map(([t, d], i) => (
              <div className="card" key={t}>
                <div className="step-num">{i + 1}</div>
                <h3>{t}</h3>
                <p className="muted small" style={{ margin: 0 }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container grid grid-2" style={{ alignItems: 'start' }}>
          <div>
            <h2>Perkara penting sebelum membeli</h2>
            <ul className="muted" style={{ paddingLeft: 18 }}>
              <li>Nombor bersifat sementara (biasanya beberapa minit) dan hanya untuk servis yang dipilih.</li>
              <li>Tidak semua platform menerima nombor maya. Sesetengah platform mungkin menyekat atau tidak menghantar SMS.</li>
              <li>Kami tidak dapat menjamin setiap OTP akan sampai kerana penghantaran bergantung kepada platform dan rangkaian pihak ketiga.</li>
              <li>Servis bank, pembayaran dan institusi kewangan tidak ditawarkan.</li>
              <li>Jangan gunakan servis ini untuk aktiviti yang menyalahi undang-undang atau terma platform lain.</li>
            </ul>
            <Link to="/polisi-refund">Baca polisi refund →</Link>
          </div>
          <div className="card card-lg">
            <h3>Kenapa MHM SMS?</h3>
            <ul className="muted" style={{ paddingLeft: 18, marginBottom: 0 }}>
              <li>Harga dalam Ringgit Malaysia, dipaparkan sebelum anda bayar.</li>
              <li>Bayar per pesanan — tiada langganan atau baki tersimpan.</li>
              <li>Pesanan aktif kekal dalam akaun walaupun halaman dimuat semula.</li>
              <li>Kod SMS dipaparkan dengan jelas dan boleh disalin dengan satu klik.</li>
              <li>Sokongan dalam Bahasa Melayu.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container center">
          <h2>Sedia untuk mula?</h2>
          <p className="muted">Daftar akaun dalam masa kurang seminit.</p>
          <Link className="btn btn-navy" to={user ? '/akaun' : '/daftar'}>
            {user ? 'Ke Akaun Saya' : 'Daftar Akaun'}
          </Link>
        </div>
      </section>
    </>
  );
}

export function Pricing() {
  const { user } = useSession();
  return (
    <section className="section">
      <div className="container narrow">
        <h1>Harga & Stok</h1>
        <p className="muted">Harga dalam RM bagi satu nombor sementara untuk satu servis. Stok berubah sepanjang masa dan akan disemak semula sebelum pembayaran.</p>
        <div className="card">
          <CatalogBrowser />
        </div>
        <div className="row" style={{ marginTop: 18 }}>
          <Link className="btn btn-primary" to={user ? '/akaun' : '/daftar'}>
            {user ? 'Beli Nombor' : 'Daftar untuk membeli'}
          </Link>
        </div>
      </div>
    </section>
  );
}

export function HowTo() {
  return (
    <section className="section">
      <div className="container narrow prose">
        <h1>Cara Guna</h1>
        <ol>
          <li><strong>Daftar dan log masuk.</strong> Semua pesanan disimpan dalam akaun anda.</li>
          <li><strong>Pilih negara dan servis</strong> di tab <em>Beli Nombor</em>. Semak harga dan stok.</li>
          <li><strong>Sahkan pesanan dan bayar.</strong> Anda akan dibawa ke halaman pembayaran. Selepas bayar, sistem menyemak status bayaran secara automatik.</li>
          <li><strong>Salin nombor</strong> yang dipaparkan dan masukkan di aplikasi atau laman yang meminta kod pengesahan.</li>
          <li><strong>Tunggu SMS.</strong> Kod akan muncul di halaman pesanan. Anda boleh tutup halaman dan kembali semula; pesanan tidak hilang.</li>
          <li><strong>Tandakan selesai</strong> selepas menerima kod, atau <strong>batal</strong> jika tiada SMS (dibenarkan selepas tempoh minimum, biasanya 2 minit; WhatsApp 5 minit).</li>
        </ol>
        <h2>Tip</h2>
        <ul>
          <li>Minta kod dari aplikasi sejurus selepas nombor dipaparkan — nombor aktif untuk tempoh terhad.</li>
          <li>Jika platform menolak nombor, cuba negara lain.</li>
          <li>Jangan gunakan nombor sementara untuk akaun penting jangka panjang, kerana nombor itu tidak boleh digunakan semula selepas tamat.</li>
        </ul>
      </div>
    </section>
  );
}

export function Faq() {
  const { config } = useSession();
  const items: [string, string][] = [
    ['Apakah MHM SMS?', 'Servis yang membekalkan nombor telefon maya sementara untuk menerima SMS pengesahan (OTP) bagi satu servis pilihan anda.'],
    ['Adakah semua platform menerima nombor ini?', 'Tidak. Sesetengah platform menyekat nombor maya atau tidak menghantar SMS ke nombor tertentu. Kami tidak dapat menjamin setiap OTP akan sampai.'],
    ['Berapa lama nombor aktif?', 'Tempoh aktif ditetapkan oleh pembekal dan dipaparkan sebagai pemasa di halaman pesanan, biasanya sekitar 15 minit.'],
    ['Bagaimana jika SMS tidak masuk?', 'Jika tiada SMS diterima dan pesanan tamat atau dibatalkan, anda boleh membuat permohonan refund dari halaman pesanan. Setiap permohonan disemak secara manual — lihat Polisi Refund.'],
    ['Boleh saya guna nombor yang sama lagi?', 'Tidak. Selepas pesanan selesai atau tamat, nombor tidak boleh digunakan semula. Sewaan nombor jangka panjang belum ditawarkan.'],
    ['Kenapa tiada servis bank atau e-wallet?', 'Pembekal kami tidak menyokong penerimaan SMS daripada bank, sistem pembayaran dan institusi kewangan. Servis tersebut tidak ditawarkan.'],
    ['Kaedah bayaran apa yang diterima?', 'Pembayaran per pesanan melalui gerbang pembayaran dalam talian (FPX). Tiada dompet atau baki tersimpan.'],
    ['Adakah kandungan SMS saya disimpan?', 'Kandungan SMS disimpan untuk tempoh terhad supaya anda boleh melihatnya, kemudian dipadam secara automatik. Lihat Dasar Privasi.'],
    ['Saya sudah bayar tetapi status belum berubah?', 'Pengesahan bayaran biasanya mengambil masa beberapa saat hingga beberapa minit. Jika masih belum berubah selepas 15 minit, hubungi support dengan nombor rujukan pesanan.'],
  ];
  return (
    <section className="section">
      <div className="container narrow">
        <h1>Soalan Lazim</h1>
        {items.map(([q, a]) => (
          <details className="faq" key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
        <p className="muted" style={{ marginTop: 20 }}>
          Ada soalan lain? <Link to="/hubungi">Hubungi kami</Link>
          {config?.supportEmail ? ` di ${config.supportEmail}` : ''}.
        </p>
      </div>
    </section>
  );
}

export function Contact() {
  const { config } = useSession();
  return (
    <section className="section">
      <div className="container narrow">
        <h1>Hubungi Support</h1>
        <p className="muted">Untuk pertanyaan pesanan, sertakan nombor rujukan pesanan (contoh: MHMXXXXXXXX). Jangan kongsi kata laluan atau kod OTP anda dengan sesiapa, termasuk kami.</p>
        <div className="grid grid-2">
          <div className="card">
            <h3>Emel</h3>
            {config?.supportEmail ? <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a> : <span className="muted">Belum ditetapkan</span>}
          </div>
          <div className="card">
            <h3>WhatsApp</h3>
            {config?.supportWhatsapp ? (
              <a href={`https://wa.me/${config.supportWhatsapp.replace(/\D/g, '')}`} rel="noopener noreferrer" target="_blank">
                {config.supportWhatsapp}
              </a>
            ) : (
              <span className="muted">Belum ditetapkan</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Draft() {
  return (
    <div className="alert alert-info small" style={{ marginBottom: 20 }}>
      Dokumen ini ialah draf awal dan perlu disemak oleh pemilik perniagaan sebelum dilancarkan secara rasmi.
    </div>
  );
}

export function Terms() {
  return (
    <section className="section">
      <div className="container narrow prose">
        <h1>Terma Penggunaan</h1>
        <Draft />
        <p>Dengan mendaftar dan menggunakan MHM SMS ("servis"), anda bersetuju dengan terma berikut. Servis dikendalikan oleh MHM CENTER.</p>
        <h2>1. Servis</h2>
        <p>Kami menyediakan akses kepada nombor telefon maya sementara untuk menerima SMS bagi satu servis yang dipilih. Nombor dibekalkan oleh pembekal pihak ketiga. Kami bukan pengendali rangkaian telekomunikasi.</p>
        <h2>2. Tiada jaminan penghantaran</h2>
        <p>Penghantaran SMS bergantung kepada platform penghantar, pembekal dan rangkaian pihak ketiga. Kami tidak menjamin bahawa sesuatu platform akan menerima nombor atau bahawa setiap SMS akan sampai.</p>
        <h2>3. Penggunaan yang dilarang</h2>
        <ul>
          <li>Sebarang aktiviti yang menyalahi undang-undang, penipuan, atau mendatangkan mudarat.</li>
          <li>Memintas sekatan, penapisan, sekatan akaun atau proses pengesahan identiti platform lain.</li>
          <li>Menerima SMS daripada bank, sistem pembayaran atau institusi kewangan.</li>
          <li>Penggunaan di mana-mana bidang kuasa yang melarang penggunaan nombor atau servis tersebut.</li>
        </ul>
        <p>Kami berhak menggantung atau menamatkan akaun yang melanggar terma ini.</p>
        <h2>4. Akaun</h2>
        <p>Anda bertanggungjawab menjaga kerahsiaan kata laluan anda. Satu akaun untuk seorang pengguna.</p>
        <h2>5. Harga dan bayaran</h2>
        <p>Harga dipaparkan dalam RM sebelum pembayaran dan mungkin berubah mengikut stok dan kos pembekal. Harga yang terpakai ialah harga yang disahkan semasa pesanan dibuat.</p>
        <h2>6. Refund</h2>
        <p>Tertakluk kepada <Link to="/polisi-refund">Polisi Refund</Link>.</p>
        <h2>7. Had liabiliti</h2>
        <p>Setakat yang dibenarkan undang-undang, liabiliti kami terhad kepada amaun yang anda bayar untuk pesanan berkenaan.</p>
        <h2>8. Perubahan terma</h2>
        <p>Terma ini boleh dikemas kini dari semasa ke semasa. Versi terkini akan sentiasa dipaparkan di halaman ini.</p>
      </div>
    </section>
  );
}

export function Privacy() {
  return (
    <section className="section">
      <div className="container narrow prose">
        <h1>Dasar Privasi</h1>
        <Draft />
        <h2>Data yang kami kumpul</h2>
        <ul>
          <li>Nama dan alamat emel untuk akaun anda.</li>
          <li>Kata laluan dalam bentuk hash sahaja (kami tidak boleh melihat kata laluan anda).</li>
          <li>Rekod pesanan dan status pembayaran (kami tidak menyimpan maklumat kad atau perbankan anda; pembayaran diproses oleh gerbang pembayaran).</li>
          <li>Kandungan SMS yang diterima pada nombor yang anda beli.</li>
        </ul>
        <p>Kami tidak meminta salinan kad pengenalan atau pasport.</p>
        <h2>Tempoh simpanan SMS</h2>
        <p>Kandungan SMS disimpan untuk tempoh terhad (lalai: 7 hari) dan kemudian dipadam secara automatik. Rekod pesanan (tanpa kandungan SMS) disimpan untuk tujuan perakaunan.</p>
        <h2>Siapa yang boleh melihat data anda</h2>
        <p>Hanya anda yang boleh melihat nombor dan SMS dalam akaun anda. Kakitangan pentadbir tidak dipaparkan kandungan SMS secara lalai.</p>
        <h2>Pihak ketiga</h2>
        <p>Pembekal nombor dan gerbang pembayaran memproses data yang diperlukan untuk melaksanakan pesanan anda.</p>
        <h2>Hak anda</h2>
        <p>Anda boleh menghubungi support untuk meminta akses atau pemadaman data akaun, tertakluk kepada keperluan rekod perakaunan.</p>
      </div>
    </section>
  );
}

export function RefundPolicy() {
  return (
    <section className="section">
      <div className="container narrow prose">
        <h1>Polisi Refund</h1>
        <Draft />
        <h2>Bila anda boleh memohon refund</h2>
        <ul>
          <li>Bayaran berjaya tetapi nombor tidak dapat disediakan (contohnya stok habis selepas bayaran). Permohonan dibuat secara automatik.</li>
          <li>Nombor diberikan tetapi <strong>tiada sebarang SMS diterima</strong>, dan pesanan tamat tempoh atau dibatalkan.</li>
        </ul>
        <h2>Bila refund tidak dapat diberikan</h2>
        <ul>
          <li>SMS telah diterima pada nombor tersebut (walaupun kod tidak berjaya digunakan di platform lain).</li>
          <li>Penyalahgunaan servis atau pelanggaran Terma Penggunaan.</li>
        </ul>
        <h2>Proses</h2>
        <ol>
          <li>Permohonan direkodkan sebagai <em>Dimohon</em> dan disemak secara manual.</li>
          <li>Jika status pesanan dengan pembekal belum dapat dipastikan, refund ditangguhkan sehingga semakan selesai.</li>
          <li>Jika diluluskan, wang dipulangkan ke akaun bank yang anda maklumkan kepada support. Status hanya ditukar kepada <em>Selesai</em> selepas pemulangan benar-benar dibuat.</li>
        </ol>
        <p>Caj pihak ketiga (contohnya caj transaksi gerbang pembayaran) mungkin tidak dapat dipulangkan.</p>
      </div>
    </section>
  );
}
