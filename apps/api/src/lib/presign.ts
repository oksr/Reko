import { AwsClient } from "aws4fetch"

/**
 * Generate a presigned PUT URL for direct upload to R2.
 * Uses aws4fetch's query-string signing (S3-compatible).
 */
export async function generatePresignedPutUrl(opts: {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  key: string
  contentType: string
  expiresIn?: number // seconds, default 3600
}): Promise<string> {
  const { accountId, accessKeyId, secretAccessKey, bucket, key, contentType, expiresIn = 3600 } = opts

  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: "s3",
  })

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`

  const signed = await client.sign(
    new Request(endpoint, {
      method: "PUT",
      headers: { "Content-Type": contentType },
    }),
    { aws: { signQuery: true, datetime: new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""), allHeaders: true }, expiresIn }
  )

  return signed.url
}
