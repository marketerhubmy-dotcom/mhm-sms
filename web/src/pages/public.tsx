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
              Pilih negara dan servis, bayar per pesanan melalui FPX atau kaedah lain yang tersedia, dan dapatkan nombor maya sementara untuk menerima kod SMS. Tiada langganan, tiada dompet tambahan.
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
    ['Bagaimana jika SMS tidak masuk?', 'Sesetengah platform menyekat nombor maya atau mengehadkan permintaan kod. Minta kod sekali sahaja dan tunggu beberapa minit. Jika tiada SMS, klik Batal (dibenarkan selepas tempoh minimum, biasanya 2 minit) dan kemudian Mohon Refund. Setiap permohonan disemak secara manual — lihat Polisi Refund.'],
    ['Bayaran saya gagal. Adakah saya dicaj?', 'Tidak. Percubaan bayaran yang gagal tidak dicaj. Anda boleh cuba bayar semula dari halaman pesanan sebelum tempoh bayaran tamat.'],
    ['Kenapa tiada servis kripto atau e-wallet?', 'Penerimaan SMS daripada bank, sistem pembayaran dan e-wallet tidak disokong oleh pembekal nombor kami. Servis pinjaman dan bursa kripto pula tidak kami tawarkan atas dasar kami sendiri, kerana risiko penyalahgunaan.'],
    ['Boleh saya guna nombor yang sama lagi?', 'Tidak. Selepas pesanan selesai atau tamat, nombor tidak boleh digunakan semula. Sewaan nombor jangka panjang belum ditawarkan.'],
    ['Kaedah bayaran apa yang diterima?', 'Pembayaran per pesanan melalui gerbang pembayaran CHIP. Kaedah yang dipaparkan di halaman pembayaran (contohnya FPX, kad atau e-wallet) bergantung kepada yang diaktifkan. Tiada dompet atau baki tersimpan.'],
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
  const wa = config?.supportWhatsapp?.replace(/\D/g, '');
  return (
    <section className="section">
      <div className="container narrow">
        <h1>Hubungi Support</h1>
        <p className="muted">Untuk pertanyaan pesanan, sertakan nombor rujukan pesanan (contoh: MHMXXXXXXXX). Jangan kongsi kata laluan atau kod OTP anda dengan sesiapa, termasuk kami.</p>
        <div className="grid grid-2">
          <div className="card">
            <h3>WhatsApp</h3>
            {wa ? (
              <a className="btn btn-primary btn-sm" href={`https://wa.me/${wa}`} rel="noopener noreferrer" target="_blank">
                Chat WhatsApp{config?.supportPhone ? ` · ${config.supportPhone}` : ''}
              </a>
            ) : (
              <span className="muted">Belum ditetapkan</span>
            )}
          </div>
          <div className="card">
            <h3>Emel</h3>
            {config?.supportEmail ? <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a> : <span className="muted">Belum ditetapkan</span>}
          </div>
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <h3>Maklumat perniagaan</h3>
          <div className="stack small">
            <div><strong>{config?.business.name ?? 'MHM CENTER'}</strong></div>
            {config?.business.regNo && <div>No. pendaftaran SSM: {config.business.regNo}</div>}
            {config?.business.address && <div>Alamat: {config.business.address}</div>}
            {config?.supportPhone && <div>Telefon: {config.supportPhone}</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

const LAST_UPDATED = '4 November 2026';

function LastUpdated() {
  return (
    <p className="small muted" style={{ marginTop: -6, marginBottom: 24 }}>
      Kemas kini terakhir: {LAST_UPDATED}
    </p>
  );
}

export function Terms() {
  const biz = useSession().config?.business;
  return (
    <section className="section">
      <div className="container narrow prose">
        <h1>Terma Penggunaan</h1>
        <LastUpdated />
        <p>
          Terma ini terpakai kepada penggunaan laman MHM SMS ("servis") yang dikendalikan oleh {biz?.name ?? 'MHM CENTER'}
          {biz?.regNo ? ` (No. pendaftaran SSM ${biz.regNo})` : ''}
          {biz?.address ? `, beralamat di ${biz.address}` : ''} ("kami"). Dengan mendaftar akaun atau membuat pesanan, anda bersetuju dengan terma ini.
        </p>

        <h2>1. Apa yang kami sediakan</h2>
        <ul>
          <li>Akses kepada <strong>nombor telefon maya sementara</strong> untuk menerima SMS daripada <strong>satu servis</strong> yang anda pilih (contohnya TikTok atau Telegram).</li>
          <li>Nombor dibekalkan oleh pembekal pihak ketiga. Kami bukan pengendali rangkaian telekomunikasi dan tidak memiliki nombor tersebut.</li>
          <li>Setiap nombor aktif untuk tempoh terhad (biasanya sekitar 15 minit, dipaparkan sebagai pemasa) dan <strong>tidak boleh digunakan semula</strong> selepas pesanan selesai, dibatalkan atau tamat.</li>
          <li>Sewaan nombor jangka panjang belum ditawarkan.</li>
        </ul>

        <h2>2. Tiada jaminan penghantaran SMS</h2>
        <p>
          Penghantaran SMS ditentukan oleh platform penghantar dan rangkaian pihak ketiga. Sesetengah platform menyekat nombor maya, menapis negara tertentu, atau
          menghadkan permintaan kod yang berulang. Kami <strong>tidak menjamin</strong> bahawa sesuatu platform akan menerima nombor atau bahawa setiap SMS akan sampai. Jika
          tiada SMS diterima, anda boleh membatalkan pesanan dan memohon refund seperti dalam <Link to="/polisi-refund">Polisi Refund</Link>.
        </p>

        <h2>3. Penggunaan yang dilarang</h2>
        <ul>
          <li>Sebarang aktiviti yang menyalahi undang-undang Malaysia atau undang-undang tempat anda berada, termasuk penipuan, penyamaran dan scam.</li>
          <li>Memintas sekatan akaun, larangan (ban), had penggunaan atau proses pengesahan identiti platform lain.</li>
          <li>Menerima SMS daripada bank, sistem pembayaran, e-wallet, pemberi pinjaman, bursa mata wang kripto atau institusi kewangan lain. Servis sebegini tidak ditawarkan.</li>
          <li>Perjudian dalam talian, termasuk kasino, taruhan sukan, poker dan loteri. Servis sebegini tidak ditawarkan.</li>
          <li>Menjual semula nombor atau kod secara automatik, atau menggunakan skrip untuk membuat pesanan secara pukal.</li>
        </ul>
        <p>Kami berhak menolak pesanan, menggantung atau menamatkan akaun yang melanggar terma ini, tanpa refund bagi pesanan yang disalahgunakan.</p>

        <h2>4. Akaun</h2>
        <p>Anda bertanggungjawab menjaga kerahsiaan kata laluan anda dan semua aktiviti dalam akaun anda. Satu akaun untuk seorang pengguna. Jangan kongsi kod OTP anda dengan sesiapa, termasuk kakitangan kami.</p>

        <h2>5. Harga dan bayaran</h2>
        <ul>
          <li>Harga dipaparkan dalam Ringgit Malaysia (RM) sebelum anda membayar. Harga boleh berubah mengikut stok dan kos pembekal; jika harga berubah sebelum pesanan disahkan, anda akan diminta mengesahkan semula.</li>
          <li>Bayaran dibuat <strong>per pesanan</strong> melalui gerbang pembayaran CHIP. Tiada dompet atau baki tersimpan dalam akaun. Kami tidak menyimpan maklumat kad atau perbankan anda.</li>
          <li>Setiap pesanan mempunyai tempoh bayaran (dipaparkan di halaman pesanan). Bayaran yang disahkan selepas tempoh itu tetap diproses jika boleh, atau direkodkan untuk refund jika nombor tidak dapat disediakan.</li>
          <li>Pesanan hanya diproses selepas bayaran <strong>disahkan oleh sistem kami dengan gerbang pembayaran</strong>; paparan halaman "berjaya" sahaja tidak mencukupi.</li>
        </ul>

        <h2>6. Membatalkan pesanan</h2>
        <ul>
          <li>Sebelum bayaran: anda boleh membatalkan pesanan bila-bila masa.</li>
          <li>Selepas nombor diberi: anda boleh membatalkan hanya jika <strong>tiada SMS diterima</strong>, dan selepas tempoh minimum yang ditetapkan oleh pembekal (biasanya 2 minit; WhatsApp 5 minit). Butang Batal akan menunjukkan baki masa menunggu.</li>
          <li>Jika SMS sudah diterima, pesanan tidak boleh dibatalkan; tandakan sebagai selesai.</li>
        </ul>

        <h2>7. Had liabiliti</h2>
        <p>
          Setakat yang dibenarkan undang-undang, servis disediakan "seadanya". Liabiliti kami bagi sesuatu pesanan terhad kepada amaun yang anda bayar untuk pesanan
          tersebut. Kami tidak bertanggungjawab atas kerugian tidak langsung, termasuk akaun di platform lain yang disekat atau tidak dapat disahkan.
        </p>

        <h2>8. Perubahan</h2>
        <p>Kami boleh mengemas kini terma ini. Versi terkini sentiasa dipaparkan di halaman ini, dan terpakai kepada pesanan yang dibuat selepas tarikh kemas kini.</p>

        <h2>9. Hubungi kami</h2>
        <p>Untuk sebarang pertanyaan, lihat halaman <Link to="/hubungi">Hubungi</Link>.</p>
      </div>
    </section>
  );
}

export function Privacy() {
  const { config } = useSession();
  return (
    <section className="section">
      <div className="container narrow prose">
        <h1>Dasar Privasi</h1>
        <LastUpdated />
        <p>Dasar ini menerangkan data peribadi yang kami kumpul dan cara kami menggunakannya, selaras dengan Akta Perlindungan Data Peribadi 2010 (PDPA).</p>

        <h2>Data yang kami kumpul</h2>
        <ul>
          <li><strong>Akaun:</strong> nama dan alamat emel.</li>
          <li><strong>Kata laluan:</strong> disimpan dalam bentuk hash sahaja. Kami tidak boleh melihat kata laluan anda.</li>
          <li><strong>Pesanan:</strong> servis, negara, nombor sementara yang diberi, harga, status dan masa.</li>
          <li><strong>Bayaran:</strong> status bayaran dan nombor rujukan transaksi daripada CHIP. Maklumat kad atau akaun bank anda diproses oleh CHIP dan <strong>tidak disimpan oleh kami</strong>.</li>
          <li><strong>Kandungan SMS</strong> yang diterima pada nombor yang anda beli.</li>
          <li><strong>Data teknikal terhad</strong> untuk keselamatan, seperti alamat IP dalam bentuk hash bagi mengehadkan cubaan log masuk.</li>
        </ul>
        <p>Kami <strong>tidak</strong> meminta salinan kad pengenalan atau pasport, dan tidak menggunakan cookie pengiklanan atau penjejakan. Cookie yang digunakan hanyalah cookie sesi log masuk yang diperlukan.</p>

        <h2>Tujuan penggunaan</h2>
        <ul>
          <li>Menyediakan nombor dan memaparkan SMS kepada anda.</li>
          <li>Mengesahkan bayaran, memproses refund dan menyimpan rekod perakaunan.</li>
          <li>Mencegah penyalahgunaan dan melindungi keselamatan akaun.</li>
          <li>Menghubungi anda tentang pesanan atau akaun anda.</li>
        </ul>

        <h2>Siapa yang boleh melihat data anda</h2>
        <ul>
          <li>Hanya anda yang boleh melihat nombor dan kandungan SMS dalam akaun anda.</li>
          <li>Kakitangan pentadbir boleh melihat maklumat pesanan untuk sokongan dan perakaunan, tetapi <strong>kandungan SMS/OTP tidak dipaparkan kepada mereka</strong>.</li>
          <li>Pihak ketiga yang memproses data bagi pihak kami: pembekal nombor (menerima SMS untuk nombor tersebut), CHIP (pembayaran), dan Cloudflare (pengehosan).</li>
        </ul>

        <h2>Tempoh simpanan</h2>
        <ul>
          <li>Kandungan SMS dipadam secara automatik selepas tempoh simpanan (lalai <strong>7 hari</strong>).</li>
          <li>Rekod pesanan dan bayaran (tanpa kandungan SMS) disimpan selagi diperlukan untuk tujuan perakaunan dan undang-undang.</li>
          <li>Sesi log masuk tamat selepas 7 hari tidak aktif.</li>
        </ul>

        <h2>Hak anda</h2>
        <p>
          Anda boleh meminta akses kepada data anda, pembetulan, atau penutupan akaun dengan menghubungi kami
          {config?.supportEmail ? <> di <a href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a></> : null}. Sesetengah rekod mungkin perlu disimpan untuk
          tujuan perakaunan.
        </p>
      </div>
    </section>
  );
}

export function RefundPolicy() {
  return (
    <section className="section">
      <div className="container narrow prose">
        <h1>Polisi Refund</h1>
        <LastUpdated />

        <h2>Anda layak memohon refund jika</h2>
        <ul>
          <li><strong>Bayaran berjaya tetapi nombor tidak dapat disediakan</strong> (contohnya stok habis selepas bayaran). Permohonan refund dibuat secara automatik.</li>
          <li><strong>Nombor diberi tetapi tiada sebarang SMS diterima</strong>, dan pesanan telah dibatalkan atau tamat tempoh. Klik <em>Mohon Refund</em> di halaman pesanan.</li>
        </ul>

        <h2>Refund tidak diberikan jika</h2>
        <ul>
          <li>SMS telah diterima pada nombor tersebut, walaupun kod itu tidak berjaya digunakan atau platform kemudian menolak nombor itu.</li>
          <li>Servis disalahgunakan atau Terma Penggunaan dilanggar.</li>
          <li>Percubaan bayaran yang tidak berjaya: tiada caj dikenakan, jadi tiada refund diperlukan.</li>
        </ul>

        <h2>Proses</h2>
        <ol>
          <li>Permohonan direkodkan dengan status <em>Dimohon</em> dan disemak secara manual oleh pasukan kami.</li>
          <li>Jika status pesanan dengan pembekal belum dapat dipastikan (contohnya gangguan sambungan semasa nombor ditempah), refund ditangguhkan sehingga semakan selesai. Ini untuk mengelakkan refund bagi nombor yang sebenarnya telah diberi.</li>
          <li>Jika diluluskan, status bertukar kepada <em>Diluluskan</em>, dan wang dipulangkan melalui kaedah pembayaran asal atau pindahan bank. Kami mungkin menghubungi anda untuk butiran akaun bank jika perlu.</li>
          <li>Status hanya ditukar kepada <em>Selesai dipulangkan</em> selepas pemulangan benar-benar dibuat, bersama nombor rujukan transaksi.</li>
        </ol>
        <p>Tempoh pemulangan bergantung kepada kaedah pembayaran dan bank. Status terkini sentiasa dipaparkan di halaman pesanan anda.</p>

        <h2>Caj</h2>
        <p>Caj pihak ketiga, seperti caj transaksi gerbang pembayaran, mungkin tidak dapat dipulangkan.</p>

        <h2>Pertanyaan</h2>
        <p>Hubungi kami melalui halaman <Link to="/hubungi">Hubungi</Link> dengan menyertakan nombor rujukan pesanan.</p>
      </div>
    </section>
  );
}
