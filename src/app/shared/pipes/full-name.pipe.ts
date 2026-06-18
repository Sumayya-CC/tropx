import { Pipe, PipeTransform } from '@angular/core';

interface NameLike {
  firstName?: string | null;
  lastName?: string | null;
}

@Pipe({
  name: 'fullName',
  standalone: true,
})
export class FullNamePipe implements PipeTransform {
  transform(
    person: NameLike | null | undefined,
    fallback = '—'
  ): string {
    if (!person) return fallback;
    const first = person.firstName?.trim() || '';
    const last = person.lastName?.trim() || '';
    const combined = [first, last]
      .filter(Boolean)
      .join(' ');
    return combined || fallback;
  }
}

interface OwnerNameLike {
  ownerFirstName?: string | null;
  ownerLastName?: string | null;
}

@Pipe({
  name: 'ownerFullName',
  standalone: true,
})
export class OwnerFullNamePipe implements PipeTransform {
  transform(
    person: OwnerNameLike | null | undefined,
    fallback = '—'
  ): string {
    if (!person) return fallback;
    const first = person.ownerFirstName?.trim() || '';
    const last = person.ownerLastName?.trim() || '';
    const combined = [first, last]
      .filter(Boolean)
      .join(' ');
    return combined || fallback;
  }
}
