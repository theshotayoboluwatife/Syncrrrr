interface UploadFileToStorageOptions {
  uploadURL: string;
  file: File | Blob;
  contentType: string;
  onProgress?: (percent: number) => void;
}

export function uploadFileToStorage({
  uploadURL,
  file,
  contentType,
  onProgress,
}: UploadFileToStorageOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.((event.loaded / event.total) * 100);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }

      reject(new Error(`Storage upload failed with status ${xhr.status}`));
    };

    xhr.onerror = () => {
      reject(new Error("Storage upload failed. Check your connection and try again."));
    };

    xhr.open("PUT", uploadURL);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.send(file);
  });
}
