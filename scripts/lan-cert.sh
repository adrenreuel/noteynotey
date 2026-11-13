#!/bin/sh
# Makes an HTTPS certificate for the dev server that a phone or iPad on the same
# network accepts. A small local certificate authority (made once, kept in .cert/)
# signs a certificate for this Mac's network address. Install .cert/noteynotey-ca.crt
# on the device and trust it once; rerun this script if the Mac's address changes.
set -e
cd "$(dirname "$0")/.."
mkdir -p .cert
cd .cert

IP="${1:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)}"
if [ -z "$IP" ]; then
  echo "Couldn't find this Mac's network address. Pass it in: npm run cert:lan -- 10.0.0.228" >&2
  exit 1
fi

if [ ! -f noteynotey-ca.key ]; then
  openssl genrsa -out noteynotey-ca.key 2048 2>/dev/null
  openssl req -x509 -new -key noteynotey-ca.key -sha256 -days 3650 \
    -subj "/CN=noteynotey local dev CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out noteynotey-ca.crt
fi

openssl genrsa -out dev.key 2048 2>/dev/null
openssl req -new -key dev.key -subj "/CN=$IP" -out dev.csr
cat > dev.ext <<EXT
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=IP:$IP,IP:127.0.0.1,DNS:localhost
EXT
# Apple devices refuse server certificates valid for more than 398 days.
openssl x509 -req -in dev.csr -CA noteynotey-ca.crt -CAkey noteynotey-ca.key -CAcreateserial \
  -days 365 -sha256 -extfile dev.ext -out dev.crt 2>/dev/null
rm -f dev.csr dev.ext

echo "Certificate made for https://$IP:5173"
echo "On the device, install and trust .cert/noteynotey-ca.crt once (see README)."
