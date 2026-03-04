import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

interface FeaturedItem {
  name: string;
  type: string;
  stockTag: string;
  image: string;
  priceLabel: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent {
  readonly heroImage = '/images/home-hero.png';

  readonly navLinks = [
    { label: 'Home', route: '/' },
    { label: 'About Us', route: '/about' },
    { label: 'Departments', route: '/about' },
    { label: 'Policies', route: '/about' },
    { label: 'Contact', route: '/about' }
  ];

  readonly categories = [
    'Emergency Medicines',
    'Pharmacy Stock',
    'Ward Consumables',
    'Surgical Supplies',
    'Laboratory Kits',
    'PPE & Safety',
    'Cold-Chain Items'
  ];

  readonly featuredItems: FeaturedItem[] = [
    {
      name: 'Paracetamol 500mg',
      type: 'Tablet',
      stockTag: 'Fast-moving',
      image: '/images/home-hero.png',
      priceLabel: '$4.50 / pack'
    },
    {
      name: 'N95 Respirator',
      type: 'Protective Gear',
      stockTag: 'Critical stock',
      image: '/inventory-front.svg',
      priceLabel: '$13.00 / box'
    },
    {
      name: 'IV Cannula 22G',
      type: 'Ward Supply',
      stockTag: 'Daily use',
      image: '/images/home-hero.png',
      priceLabel: '$19.00 / set'
    },
    {
      name: 'Surgical Gloves M',
      type: 'OR Consumable',
      stockTag: 'High demand',
      image: '/inventory-front.svg',
      priceLabel: '$9.20 / box'
    }
  ];

  readonly quickPanels = ["What's New", 'Information', 'Bestsellers', 'Specials'];

  private readonly fallbackImage = '/inventory-front.svg';

  useFallbackImage(event: Event): void {
    const target = event.target as HTMLImageElement | null;
    if (!target) {
      return;
    }

    if (!target.src.includes(this.fallbackImage)) {
      target.src = this.fallbackImage;
    }
  }
}
