import { Injectable, inject } from '@angular/core';
import {
  Firestore, doc, collection, collectionData, docData,
  addDoc, setDoc, updateDoc, serverTimestamp,
  query, QueryConstraint, DocumentReference,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class FirestoreService {
  private readonly _db = inject(Firestore);

  getDocument<T>(path: string): Observable<T | null> {
    // docData streams a document and auto-maps id
    // idField option injects the document ID into the returned object
    return (docData(doc(this._db, path), { idField: 'id' }) as Observable<T | undefined>).pipe(
      map(data => data ?? null)
    );
  }


  getCollection<T>(
    path: string,
    ...constraints: any[]
  ): Observable<T[]> {
    // collectionData streams a collection with optional constraints
    const ref = collection(this._db, path);
    const q = constraints.length ? query(ref, ...constraints) : ref;
    return collectionData(q, { idField: 'id' }) as Observable<T[]>;
  }

  addDocument<T>(path: string, data: T): Promise<DocumentReference> {
    return addDoc(collection(this._db, path), data as object);
  }

  setDocument<T>(path: string, data: T): Promise<void> {
    return setDoc(doc(this._db, path), data as object);
  }

  updateDocument(path: string, data: Partial<unknown>): Promise<void> {
    return updateDoc(doc(this._db, path), data as object);
  }

  softDelete(path: string, deletedBy: string): Promise<void> {
    // Status transition instead of hard delete — preserves audit trail
    return updateDoc(doc(this._db, path), {
      isDeleted: true,
      deletedAt: serverTimestamp(),
      deletedBy,
    });
  }

  async runBatch(fn: (batch: any, db: Firestore) => Promise<void> | void): Promise<void> {
    const { writeBatch } = await import('@angular/fire/firestore');
    const batch = writeBatch(this._db);
    await fn(batch, this._db);
    return batch.commit();
  }

  // hardDelete permanently commented out — never call in production
  // hardDelete(path: string): Promise<void> { return deleteDoc(doc(this._db, path)); }
}
