package crypto

import (
	"crypto/rand"
	"testing"

	"golang.org/x/crypto/nacl/box"
)

// Assumption:
// 	- 1 token = 2 bytes
// 	- 1 KB = 1024 bytes
//  - Average message size = 1024 tokens = 2048 bytes

func benchmarkAsymmetricEncrypt(dataSizeKB int, b *testing.B) {
	recipientPublicKey, _, err := box.GenerateKey(rand.Reader)
	if err != nil {
		b.Fatal(err)
	}

	// Generate a random message of dataSizeKB KB
	message := make([]byte, dataSizeKB*1024)
	_, err = rand.Read(message)
	if err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := AsymmetricEncrypt(*recipientPublicKey, message)
		if err != nil {
			b.Fatal(err)
		}
	}
}

func benchmarkSymmetricEncrypt(dataSizeKB int, b *testing.B) {
	recipientPublicKey, _, err := box.GenerateKey(rand.Reader)
	if err != nil {
		b.Fatal(err)
	}

	// Generate a random message of dataSizeKB KB
	message := make([]byte, dataSizeKB*1024)
	_, err = rand.Read(message)
	if err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		symmetricKey, _, err := SymmetricEncrypt(message)
		if err != nil {
			b.Fatal(err)
		}
		// Need to benchmark both encrypting the message and encrypting the symmetric key
		_, err = AsymmetricEncrypt(*recipientPublicKey, symmetricKey[:])
		if err != nil {
			b.Fatal(err)
		}
	}
}

// Asymmetric encryption benchmarks
// Emulates the encryption of a message using the recipient's (conversations) public key
func BenchmarkAsymmetricEncrypt1KB(b *testing.B)  { benchmarkAsymmetricEncrypt(1, b) }
func BenchmarkAsymmetricEncrypt2KB(b *testing.B)  { benchmarkAsymmetricEncrypt(2, b) }
func BenchmarkAsymmetricEncrypt5KB(b *testing.B)  { benchmarkAsymmetricEncrypt(5, b) }
func BenchmarkAsymmetricEncrypt10KB(b *testing.B) { benchmarkAsymmetricEncrypt(10, b) }

func BenchmarkAsymmetricEncrypt500KB(
	b *testing.B,
) {
	benchmarkAsymmetricEncrypt(512, b)
}

func BenchmarkAsymmetricEncrypt1MB(
	b *testing.B,
) {
	benchmarkAsymmetricEncrypt(1024, b)
}

func BenchmarkAsymmetricEncrypt10MB(
	b *testing.B,
) {
	benchmarkAsymmetricEncrypt(10*1024, b)
}

// Symmetric encryption benchmarks
// Emulates the encryption of a message using symmetric key encryption
// and then encrypting the symmetric key using the recipient's (conversations) public key
func BenchmarkSymmetricEncrypt1KB(b *testing.B)  { benchmarkSymmetricEncrypt(1, b) }
func BenchmarkSymmetricEncrypt2KB(b *testing.B)  { benchmarkSymmetricEncrypt(2, b) }
func BenchmarkSymmetricEncrypt5KB(b *testing.B)  { benchmarkSymmetricEncrypt(5, b) }
func BenchmarkSymmetricEncrypt10KB(b *testing.B) { benchmarkSymmetricEncrypt(10, b) }

func BenchmarkSymmetricEncrypt500KB(b *testing.B) {
	benchmarkSymmetricEncrypt(512, b)
}
func BenchmarkSymmetricEncrypt1MB(b *testing.B) { benchmarkSymmetricEncrypt(1024, b) }
func BenchmarkSymmetricEncrypt10MB(b *testing.B) {
	benchmarkSymmetricEncrypt(10*1024, b)
}
