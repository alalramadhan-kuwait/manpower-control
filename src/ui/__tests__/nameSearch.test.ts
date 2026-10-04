import { describe, expect, it } from 'vitest';
import { nameFilter, skeletonArabic, skeletonLatin } from '../nameSearch';

const people = ['Yaser Asiri', 'Jasem Sadeq', 'Mohammad Alajmi', 'Abdullah Almunies', 'Abdulaziz Alajmi', 'Hamad Alzanki', 'Khaled Almutairi', 'Ebraheem Almanaseer', 'Nawaf Aldasem', 'Talal Alenezi', 'Ali Alajmi', 'Saleh Alajmi', 'Fahad Alajmi'];
const find = (q: string) => people.filter((p) => nameFilter(q)([p]));

describe('name search', () => {
  it('English search works as before', () => {
    expect(find('yaser')).toEqual(['Yaser Asiri']);
    expect(find('alajmi ali')).toEqual(['Ali Alajmi']);
    expect(find('')).toHaveLength(people.length);
  });
  it('an Arabic first name finds the English spelling', () => {
    expect(find('ياسر')).toEqual(['Yaser Asiri']);
    expect(find('جاسم')).toEqual(['Jasem Sadeq']);
    expect(find('محمد')).toEqual(['Mohammad Alajmi']);
    expect(find('خالد')).toEqual(['Khaled Almutairi']);
    expect(find('ابراهيم')).toEqual(['Ebraheem Almanaseer']);
    expect(find('نواف')).toEqual(['Nawaf Aldasem']);
    expect(find('طلال')).toEqual(['Talal Alenezi']);
  });
  it('family names, with or without the ال', () => {
    expect(find('العجمي')).toEqual(['Mohammad Alajmi', 'Abdulaziz Alajmi', 'Ali Alajmi', 'Saleh Alajmi', 'Fahad Alajmi']);
    expect(find('عجمي')).toEqual(find('العجمي'));
    expect(find('المنيس')).toContain('Abdullah Almunies');   // a skeleton that starts the same (Almanaseer) shows too
    expect(find('المطيري')).toEqual(['Khaled Almutairi']);
  });
  it('first and family name together narrow it down', () => {
    expect(find('محمد العجمي')).toEqual(['Mohammad Alajmi']);
    expect(find('فهد العجمي')).toEqual(['Fahad Alajmi']);
  });
  it('a name in two Arabic words but one English word', () => {
    expect(find('عبد الله')).toEqual(['Abdullah Almunies']);
    expect(find('عبد العزيز')).toEqual(['Abdulaziz Alajmi']);
    expect(find('عبدالله المنيس')).toEqual(['Abdullah Almunies']);
  });
  it('Arabic numerals find the employee number', () => {
    expect(nameFilter('١٦٩٤٩')(['Jasem Sadeq', '16949'])).toBe(true);
    expect(nameFilter('١٦٩٤٩')(['Yaser Asiri', '17407'])).toBe(false);
  });
  it('skeletons', () => {
    expect(skeletonArabic('الصايغ')).toBe(skeletonLatin('Al-Saegh'));
    expect(skeletonLatin('Mohammed')).toBe(skeletonLatin('Muhammad'));
  });
});
