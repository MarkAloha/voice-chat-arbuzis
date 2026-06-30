import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CONTACT_URL } from '../../../shared/contact';

@Component({
    selector: 'app-roadmap',
    imports: [RouterLink],
    templateUrl: './roadmap.html',
    styleUrl: './roadmap.scss',
})
export class RoadmapComponent {
    protected readonly contactUrl = CONTACT_URL;
}
