FanzStore — README

Pembuat: Fatih & ChatGPT 😹

Dokumen ini menjelaskan cara menggunakan src/api.js (centralized API caller) dan src/image.js (daftar gambar) di proyek FanzStore, contoh pemanggilan, struktur return, dan tips integrasi ke front-end (iyah.json, required fields, dll).


---

Ringkasan singkat

src/api.js adalah helper pusat untuk memanggil upstream APIs yang sudah didaftarkan di registry APIs.

Apis(name, pathOrUrl, payload, options) dipakai untuk melakukan request ke service bernama name.

src/image.js adalah koleksi array URL gambar yang dapat dipakai plugin "random image".

File iyah.json dihasilkan dari handler.js dan menyimpan metadata plugin (path, params, required flag) — front-end membaca ini untuk membangun UI.


> Jika kamu lupa file index.html yang sedang kamu edit, file sedang berada di: /mnt/data/index.html (lokal upload di Replit / container).




---

src/api.js — ringkasan fungsional

File: src/api.js

Export utama

Apis(name, pathOrUrl='/', payload, options = {}) — fungsi async.

Utilities: register, update, remove, list,  _APIs (registry raw).


Perilaku utamanya

name harus ada di registry APIs; kalau tidak, fungsi akan mengembalikan { success: false, error: 'Service "name" not registered' }.

pathOrUrl bisa berupa path (mis. /random/waguri) yang digabungkan ke baseURL service, atau full URL (https://...) — fungsi mendeteksi otomatis.

payload bersifat opsional:

Untuk GET/DELETE:

Jika payload adalah objek berisi kunci, maka akan di-encode sebagai querystring ?a=x&b=y.

Jika payload adalah undefined/kosong — tidak ada querystring tambahan.


Untuk POST/PUT/PATCH:

Jika payload === undefined, body akan dikirim {} (empty JSON object) agar upstream tidak error karena body kosong.

Jika payload ada, dikirim sebagai JSON (header Content-Type: application/json).



Timeout default DEFAULT_TIMEOUT = 15000 ms (15s) — dapat dioverride lewat options.timeoutMs.

Mengembalikan objek yang konsisten:


// success
{ success: true, provider: name, base, url, status, data }
// failure (upstream non-200)
{ success: false, provider: name, base, url, status, data, error: 'HTTP 502' }
// network/timeout error
{ success: false, error: 'Timeout 15000ms' /* or error message */, provider: name, url }

Contoh pemanggilan (Node.js)

const { Apis } = require('./src/api');

// GET tanpa payload
const res1 = await Apis('archive', '/random/blue-archive');
// GET dengan query params
const res2 = await Apis('nekorinn', '/ai/ai4chat', { text: 'halo' });
// Panggil full URL langsung (melewati registry baseURL)
const res3 = await Apis('nekorinn', 'https://api.nekolabs.web.id/ai/ai4chat/chat?text=hai');
// POST with payload
const res4 = await Apis('gtech', '/some/post', { foo: 'bar' }, { method: 'post' });

if (res2.success) console.log(res2.data);
else console.error('error', res2.error || res2.status);

Mengatur registry di runtime

const { register, update, remove, list } = require('./src/api');
register('myservice', 'https://example.com');
update('myservice', { baseURL: 'https://new.example.com' });
console.log(list());
remove('myservice');


---

src/image.js — cara pakai

File: src/image.js berisi kumpulan array URL gambar yang dapat dipanggil oleh plugin random-image.

Contoh struktur:

module.exports = {
  random_waguri: [ 'https://...jpg', 'https://...png' ],
  random_blue_archive: [ 'https://files.catbox.moe/xxx.jpeg', ... ]
}

Contoh penggunaan di plugin (pseudo-code)

const images = require('../src/image');
// pilih random dari salah satu key
const arr = images.random_waguri;
const pick = arr[Math.floor(Math.random()*arr.length)];
res.json({ url: pick });

Plugin di folder plugins/ bisa membaca src/image.js dan mengembalikan URL tersebut ke klien.


---

Integrasi front-end (iyah.json, required fields, 'text' auto-required)

File handler.js (loader) yang kamu jalankan akan normalisasikan params plugin agar berbentuk objek:

"params": {
  "text": { "description": "...", "required": true },
  "limit": { "description": "...", "required": false }
}

Catatan penting: ada heuristic default: parameter bernama text akan diberi required: true kecuali plugin secara eksplisit mendefinisikannya.

Front-end (index.html) harus membaca iyah.json lalu membuat input form. Untuk menandai required otomatis, lakukan:

// contoh pembuatan input
if(item.params && item.params.xxx && item.params.xxx.required){
  input.setAttribute('required','');
}

Atau gunakan util yang sudah kamu buat (validation-utils.js / applyFieldRules) untuk menerapkan aturan required ke container form.


---

Contoh plugin sederhana (random image)

// plugins/random_waguri.js
const images = require('../src/image');
module.exports = {
  name: 'random_waguri',
  category: 'RANDOM',
  path: '/random/waguri',
  method: 'get',
  desc: 'Random waguri image',
  params: {},
  handler: async (req, res) => {
    const arr = images.random_waguri || [];
    if (!arr.length) return res.status(404).json({ success:false, message:'no images' });
    const pick = arr[Math.floor(Math.random()*arr.length)];
    return res.json({ success:true, url: pick });
  }
}


---

Debugging & tips

Jika response res.ok false, Apis akan mengembalikan success: false dan menyertakan status serta data (body upstream jika ada).

Untuk memaksa permintaan tanpa payload pada GET, panggil Apis(name, '/some/path') (tanpa payload argumen) — tidak akan menambahkan ? kosong.

Untuk memanggil full URL eksternal menggunakan helper Apis, berikan pathOrUrl berupa https://... dan name masih diperlukan (dipakai sebagai provider label); jika name tidak ada di registry, Apis akan mengembalikan error sebelum mencoba URL. Jika kamu ingin bypass registry, tambahkan APIs['direct'] = { baseURL: '' } dan panggil Apis('direct', 'https://full.url').

Timeout default 15s; jika upstream sering lambat, sesuaikan options.timeoutMs.



---

Contoh output iyah.json (potongan)

{
  "categories": [
    {
      "name": "AI",
      "items": [
        {
          "name": "ai4chat",
          "path": "/ai/ai4chat/chat?text=",
          "desc": "...",
          "status": "ready",
          "params": { "text": { "description": "...", "required": true } },
          "category": "AI"
        }
      ]
    }
  ]
}

Front-end bisa membaca params per item dan membuat input, menandai required bila perlu.


---

Author & Credits

Pembuat: Fatih

Dokumentasi awal di-generate oleh ChatGPT (assistant)



---

File penting dalam project (lokasi)

src/api.js — centralized API caller (lihat kode di repo).

src/image.js — daftar URL gambar (random lists).

handler.js — loader plugin, men-generate iyah.json.

iyah.json — file output untuk front-end.

index.html (UI) berada di: /mnt/data/index.html



---

Kalau mau, aku bisa juga:

Tambahin contoh curl untuk masing-masing endpoint yang ada di iyah.json.

Patch index.html agar otomatis membaca params.*.required dan menandai required di input.
